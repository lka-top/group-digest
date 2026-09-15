/**
 * 群与群配置路由
 */
import { Router } from 'express';
import * as db from '../db.js';
import { getAdapter } from '../adapters/index.js';
import type { PlatformAdapter } from '../adapters/types.js';
import eventBus from '../eventBus.js';
import { asBooleanInt, asFiniteNumber } from './validation.js';
import { backfillHistoryRange } from '../ingest/history.js';

export const groupsRouter = Router();

const PROCESSING_MODES = new Set<db.GroupProcessingMode>(['off', 'record', 'summary', 'push']);

function asProcessingMode(value: unknown): db.GroupProcessingMode | undefined {
  return typeof value === 'string' && PROCESSING_MODES.has(value as db.GroupProcessingMode)
    ? (value as db.GroupProcessingMode)
    : undefined;
}

export interface GroupSyncResult {
  total: number;
  created: number;
  updated: number;
  accounts?: number;
  failedAccounts?: string[];
}

/** 将适配器的群元数据同步到数据库，供启动流程和手动接口复用。 */
export async function syncGroupsFromAdapter(
  adapter: PlatformAdapter,
  accountSelfId?: string
): Promise<GroupSyncResult> {
  const selfId = accountSelfId || adapter.getSelfId();
  if (!selfId) throw new Error('尚无已识别的平台账号连接');
  const runtimeAccount = adapter.getAccounts().find((item) => item.selfId === selfId);
  const account = db.upsertPlatformAccount({
    platform: adapter.platform,
    self_id: selfId,
    display_name: runtimeAccount?.displayName,
    status: runtimeAccount?.status || adapter.getStatus(),
  });
  const groups = await adapter.getGroups(selfId);
  let created = 0;
  let updated = 0;
  for (const g of groups) {
    const result = db.upsertGroup({
      platform_account_id: account.id,
      platform_group_id: g.platformGroupId,
      name: g.name,
      member_count: g.memberCount,
      max_member_count: g.maxMemberCount,
      avatar: g.avatar,
      default_enabled: false,
    });
    if (result.created) created += 1;
    else updated += 1;
  }
  eventBus.emitEvent({ type: 'groups_synced', adapter: adapter.platform, count: groups.length });
  return { total: groups.length, created, updated };
}

export async function syncAllGroupsFromAdapter(adapter: PlatformAdapter): Promise<GroupSyncResult> {
  const accounts = adapter.getAccounts().filter((account) => account.status === 'connected');
  if (accounts.length === 0) throw new Error('当前没有已连接的平台账号');
  const settled = await Promise.allSettled(
    accounts.map(async (account) => ({
      selfId: account.selfId,
      result: await syncGroupsFromAdapter(adapter, account.selfId),
    }))
  );
  const results = settled
    .filter((result): result is PromiseFulfilledResult<{ selfId: string; result: GroupSyncResult }> => result.status === 'fulfilled')
    .map((result) => result.value.result);
  const failedAccounts = settled.flatMap((result, index) =>
    result.status === 'rejected' ? [accounts[index].selfId] : []
  );
  if (results.length === 0) {
    throw new Error(`所有在线账号同步失败：${failedAccounts.join('、')}`);
  }
  return results.reduce(
    (total, current) => ({
      total: total.total + current.total,
      created: total.created + current.created,
      updated: total.updated + current.updated,
      accounts: accounts.length,
      failedAccounts,
    }),
    { total: 0, created: 0, updated: 0, accounts: accounts.length, failedAccounts }
  );
}

/** 群列表（含配置与消息数） */
groupsRouter.get('/', (_req, res) => {
  try {
    res.json({ groups: db.getAllGroupsWithConfig() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** 从适配器同步群列表 */
groupsRouter.post('/sync', async (_req, res) => {
  try {
    const adapter = getAdapter();
    const result = await syncAllGroupsFromAdapter(adapter);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** 将处理模式/优先级向下应用到根、平台或账号节点下的全部群。 */
groupsRouter.patch('/config/bulk', (req, res) => {
  try {
    const { scope, platform, platform_account_id: platformAccountId, processing_mode: processingMode, priority, enabled } =
      req.body ?? {};
    const parsedEnabled = asBooleanInt(enabled);
    const parsedMode = processingMode === undefined ? undefined : asProcessingMode(processingMode);
    const parsedPriority =
      priority === undefined ? undefined : asFiniteNumber(priority, { integer: true, min: 0, max: 999 });
    if (!['all', 'platform', 'account'].includes(scope)) {
      return res.status(400).json({ error: 'scope 必须是 all、platform 或 account' });
    }
    if (
      (processingMode !== undefined && parsedMode === undefined) ||
      (priority !== undefined && parsedPriority === undefined) ||
      (enabled !== undefined && parsedEnabled === undefined)
    ) {
      return res.status(400).json({ error: '处理模式无效，priority 必须是 0~999 的整数' });
    }
    if (parsedMode === undefined && parsedPriority === undefined && parsedEnabled === undefined) {
      return res.status(400).json({ error: 'processing_mode、priority 或 enabled 至少提供一项' });
    }
    if (scope === 'platform' && (typeof platform !== 'string' || !platform.trim())) {
      return res.status(400).json({ error: '平台节点缺少 platform' });
    }
    if (scope === 'account' && (typeof platformAccountId !== 'string' || !platformAccountId.trim())) {
      return res.status(400).json({ error: '账号节点缺少 platform_account_id' });
    }

    const target =
      scope === 'all'
        ? { type: 'all' as const }
        : scope === 'platform'
          ? { type: 'platform' as const, platform: platform.trim() }
          : { type: 'account' as const, platformAccountId: platformAccountId.trim() };
    // enabled 仅为旧客户端兼容；新界面统一使用四档 processing_mode。
    const effectiveMode = parsedMode ?? (parsedEnabled === undefined ? undefined : parsedEnabled === 1 ? 'record' : 'off');
    const result = db.updateGroupPolicyByScope(target, {
      processingMode: effectiveMode,
      priority: parsedPriority,
    });
    if (result.matched === 0) return res.status(404).json({ error: '该节点下没有可配置的群' });

    eventBus.emitEvent({ type: 'group_config', count: result.updated });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** 明确授权后，回填指定群的最近消息。 */
groupsRouter.post('/:id/history', async (req, res) => {
  try {
    const group = db.getGroupById(req.params.id);
    if (!group) return res.status(404).json({ error: '群不存在' });
    if (group.enabled !== 1) return res.status(400).json({ error: '请先开启“读取该群消息”再回填历史' });

    const count = asFiniteNumber(req.body?.count ?? 100, { integer: true, min: 1, max: 200 });
    if (count === undefined) return res.status(400).json({ error: 'count 必须是 1~200 的整数' });

    const adapter = getAdapter();
    if (adapter.platform !== group.platform) {
      return res.status(400).json({ error: `当前适配器无法读取 ${group.platform} 群历史` });
    }
    if (!adapter.getGroupHistory) {
      return res.status(501).json({ error: '当前平台适配器不支持历史消息回填' });
    }

    // “最近 N 条”仍只请求一页；时间范围回填由总结接口持续向前翻页。
    const result = await backfillHistoryRange({
      adapter,
      group,
      start: new Date(0).toISOString(),
      end: new Date().toISOString(),
      pageSize: count,
      maxPages: 1,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** 群详情 */
groupsRouter.get('/:id', (req, res) => {
  const group = db.getGroupById(req.params.id);
  if (!group) return res.status(404).json({ error: '群不存在' });
  const config = db.getGroupConfig(group.id);
  res.json({ group, config });
});

/** 恢复采用账号/平台/根节点的默认策略。 */
groupsRouter.post('/:id/inherit', (req, res) => {
  try {
    const config = db.inheritGroupPolicy(req.params.id);
    if (!config) return res.status(404).json({ error: '群不存在' });
    eventBus.emitEvent({ type: 'group_config', count: 1 });
    res.json({ ok: true, config });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** 更新群配置；processing_mode 是推荐入口，旧开关字段仍兼容并自动满足依赖链。 */
groupsRouter.patch('/:id/config', (req, res) => {
  const { processing_mode: processingMode, enabled, priority, summary_enabled, push_enabled, default_schedule_id } =
    req.body ?? {};
  const group = db.getGroupById(req.params.id);
  if (!group) return res.status(404).json({ error: '群不存在' });

  const parsedEnabled = asBooleanInt(enabled);
  const parsedSummaryEnabled = asBooleanInt(summary_enabled);
  const parsedPushEnabled = asBooleanInt(push_enabled);
  const parsedMode = processingMode === undefined ? undefined : asProcessingMode(processingMode);
  const parsedPriority =
    priority === undefined ? undefined : asFiniteNumber(priority, { integer: true, min: 0, max: 999 });
  if (
    (enabled !== undefined && parsedEnabled === undefined) ||
    (summary_enabled !== undefined && parsedSummaryEnabled === undefined) ||
    (push_enabled !== undefined && parsedPushEnabled === undefined) ||
    (processingMode !== undefined && parsedMode === undefined) ||
    (priority !== undefined && parsedPriority === undefined)
  ) {
    return res.status(400).json({ error: '开关值格式无效，priority 必须是 0~999 的整数' });
  }

  const existingConfig = db.getGroupConfig(group.id);
  let modeConfig = parsedMode ? db.processingModeConfig(parsedMode) : {
    enabled: existingConfig.enabled as 0 | 1,
    summary_enabled: existingConfig.summary_enabled as 0 | 1,
    push_enabled: existingConfig.push_enabled as 0 | 1,
  };
  if (!parsedMode) {
    if (parsedEnabled !== undefined) {
      modeConfig.enabled = parsedEnabled;
      if (parsedEnabled === 0) {
        modeConfig.summary_enabled = 0;
        modeConfig.push_enabled = 0;
      }
    }
    if (parsedSummaryEnabled !== undefined) {
      modeConfig.summary_enabled = parsedSummaryEnabled;
      if (parsedSummaryEnabled === 1) modeConfig.enabled = 1;
      else modeConfig.push_enabled = 0;
    }
    if (parsedPushEnabled !== undefined) {
      modeConfig.push_enabled = parsedPushEnabled;
      if (parsedPushEnabled === 1) {
        modeConfig.enabled = 1;
        modeConfig.summary_enabled = 1;
      }
    }
  }
  const authorizedAt =
    modeConfig.enabled === 1 && (existingConfig.enabled !== 1 || !existingConfig.authorized_at)
      ? new Date().toISOString()
      : undefined;
  const ok = db.updateGroupConfig(group.id, {
    ...(processingMode !== undefined || enabled !== undefined || summary_enabled !== undefined || push_enabled !== undefined
      ? modeConfig
      : {}),
    mode_source:
      processingMode !== undefined || enabled !== undefined || summary_enabled !== undefined || push_enabled !== undefined
        ? 'group'
        : undefined,
    authorized_at: authorizedAt,
    priority: parsedPriority,
    priority_source: priority !== undefined ? 'group' : undefined,
    default_schedule_id,
  });
  if (!ok) return res.status(400).json({ error: '没有可更新的配置字段' });
  eventBus.emitEvent({ type: 'group_config', count: 1 });
  res.json({ ok, config: db.getGroupConfig(group.id) });
});
