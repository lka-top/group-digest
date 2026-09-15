/**
 * 入站消息处理管道
 *
 * 从适配器拿到的统一消息，经过：
 *   平台账号/群归集 → 群过滤 → CQ 解析 → 脏数据过滤 → 去重入库
 *   → 实时广播 → 优先级规则匹配（即时提醒）
 * 最终落地为可被「消息浏览 / AI 总结」使用的数据。
 */
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db.js';
import eventBus from '../eventBus.js';
import type { PlatformAdapter, UnifiedMessage } from '../adapters/types.js';
import { parseCqCode } from './cqcode.js';
import { notifyInstant } from '../notify/dispatcher.js';

let adapterRef: PlatformAdapter | null = null;
const groupNameCache = new Map<string, string>();
const BOT_DISPLAY_NAMES: Record<string, string> = {
  qq: '总结机器人',
};

/** 绑定当前适配器（用于获取 self_id 与群名） */
export function bindAdapter(adapter: PlatformAdapter): void {
  adapterRef = adapter;
}

async function resolveGroupName(platformGroupId: string, accountSelfId: string): Promise<string> {
  const cacheKey = `${accountSelfId}:${platformGroupId}`;
  const cached = groupNameCache.get(cacheKey);
  if (cached) return cached;
  if (adapterRef) {
    try {
      const groups = await adapterRef.getGroups(accountSelfId);
      for (const g of groups) groupNameCache.set(`${accountSelfId}:${g.platformGroupId}`, g.name);
    } catch (err) {
      console.warn('[pipeline] 获取群列表失败:', err);
    }
  }
  return groupNameCache.get(cacheKey) || `群 ${platformGroupId}`;
}

export interface IngestResult {
  stored: boolean;
  skipped?: 'disabled' | 'before_authorization' | 'duplicate' | 'empty';
  messageId?: string;
  groupId?: string;
  groupName?: string;
}

export interface IngestOptions {
  /** live 受授权时间边界约束；backfill 仅由显式历史回填接口使用。 */
  source?: 'live' | 'backfill';
}

/** 处理一条入站消息 */
export async function ingest(msg: UnifiedMessage, options: IngestOptions = {}): Promise<IngestResult> {
  // 1. 平台账号归集
  const accountSelfId = msg.accountSelfId || adapterRef?.getSelfId() || null;
  const account = db.upsertPlatformAccount({
    platform: msg.platform,
    self_id: accountSelfId,
    status: 'connected',
  });

  // 2. 群归集（不存在则自动建群）
  let group = db.getGroupByPlatform(account.id, msg.platformGroupId);
  if (!group) {
    const name = await resolveGroupName(msg.platformGroupId, accountSelfId || 'default');
    const res = db.upsertGroup({
      platform_account_id: account.id,
      platform_group_id: msg.platformGroupId,
      name,
      default_enabled: false,
    });
    group = res.group;
  }

  // 3. 群过滤：被禁用的群不读取
  const groupConfig = db.getGroupConfig(group.id);
  if (groupConfig.enabled !== 1) {
    return { stored: false, skipped: 'disabled', groupId: group.id };
  }

  const source = options.source ?? 'live';
  const messageTimestamp = new Date(msg.timestamp).toISOString();
  if (
    source === 'live' &&
    groupConfig.authorized_at &&
    Date.parse(messageTimestamp) < Date.parse(groupConfig.authorized_at)
  ) {
    return { stored: false, skipped: 'before_authorization', groupId: group.id };
  }

  // 4. CQ 解析
  const selfId = accountSelfId || undefined;
  const botName = BOT_DISPLAY_NAMES[msg.platform] || '机器人';
  const parsed = msg.cqParsed
    ? { text: msg.content, media: msg.media || [], isAtSelf: Boolean(msg.isAtSelf), isAtAll: false }
    : parseCqCode(msg.rawContent, selfId, (qq) => (qq === selfId ? botName : undefined));

  const content = parsed.text;
  if (!content) {
    return { stored: false, skipped: 'empty', groupId: group.id };
  }

  // 5. 入库（UNIQUE(group_id, platform_message_id) 负责去重）
  const record: db.DbGroupMessage = {
    id: uuidv4(),
    group_id: group.id,
    platform_message_id: msg.platformMessageId,
    sender_id: msg.senderId,
    sender_name: msg.senderName,
    sender_card: msg.senderCard ?? null,
    sender_role: msg.senderRole ?? null,
    content,
    raw_content: msg.rawContent,
    cq_parsed: 1,
    message_type: msg.messageType,
    sub_type: msg.subType ?? null,
    seq: msg.seq ?? null,
    ingest_source: source,
    timestamp: messageTimestamp,
    created_at: new Date().toISOString(),
  };

  const { inserted } = db.insertGroupMessage(record);
  if (!inserted) {
    return { stored: false, skipped: 'duplicate', groupId: group.id };
  }

  // 历史回填只补充总结数据，不伪装成实时新消息，也不触发过期的即时提醒。
  if (source === 'live') {
    // 6. 实时广播
    eventBus.emitEvent({
      type: 'message',
      groupId: group.id,
      message: {
        id: record.id,
        groupId: group.id,
        groupName: group.name,
        senderId: record.sender_id || '',
        senderName: record.sender_name || '',
        content: record.content,
        timestamp: record.timestamp,
      },
    });

    // 7. 优先级规则匹配 → 即时提醒
    await matchPriorityRules(group.id, group.name, record);
  }

  return { stored: true, messageId: record.id, groupId: group.id, groupName: group.name };
}

/** 匹配启用的优先级规则，命中则触发即时提醒 */
async function matchPriorityRules(
  groupId: string,
  groupName: string,
  message: db.DbGroupMessage
): Promise<void> {
  const rules = db.getPriorityRules(true);
  if (rules.length === 0) return;

  for (const rule of rules) {
    if (rule.scope_type === 'group' && rule.group_id !== groupId) continue;

    const content = message.content || '';
    const senderName = message.sender_name || '';
    const senderId = message.sender_id || '';

    let hit = false;
    switch (rule.match_type) {
      case 'keyword':
        hit = content.includes(rule.pattern);
        break;
      case 'sender':
        hit = senderName.includes(rule.pattern) || senderId === rule.pattern;
        break;
      case 'regex':
        try {
          hit = new RegExp(rule.pattern).test(content);
        } catch {
          hit = false;
        }
        break;
      default:
        hit = false;
    }

    if (hit && rule.action === 'instant_notify') {
      await notifyInstant({
        groupId,
        groupName,
        ruleId: rule.id,
        ruleName: rule.name,
        priority: rule.priority,
        message,
      });
    }
  }
}
