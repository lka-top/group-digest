/**
 * 通知分发器
 *
 * 职责：
 * 1. 生成站内通知（写 notifications 表）并通过事件总线广播给前端 SSE；
 * 2. 按 channels 分发到其他通道（当前：邮件；站内为默认通道）；
 * 3. 对「高优先级即时提醒」做节流（冷却 + 全局令牌桶），避免刷屏。
 */
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db.js';
import config from '../config.js';
import eventBus from '../eventBus.js';
import { sendEmail, isEmailConfigured, type SmtpOptions } from './email.js';

export type NotifyChannel = 'console' | 'email';

interface NotifyCommon {
  groupId?: string | null;
  groupName?: string | null;
  summaryId?: string | null;
  title: string;
  body: string;
  priority?: number;
  channels?: NotifyChannel[];
  emailTo?: string | null;
  smtp?: Partial<SmtpOptions>;
}

// ---- 即时提醒节流状态 ----
const lastInstantAt = new Map<string, number>(); // key: groupId:ruleId
const instantTimestamps: number[] = []; // 全局令牌桶（滑动窗口）

function instantAllowed(key: string): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const cooldown = config.notify.instantCooldownMs;
  const last = lastInstantAt.get(key);
  if (last !== undefined && now - last < cooldown) {
    return { allowed: false, reason: 'cooldown' };
  }
  // 滑窗限流
  const cutoff = now - 60_000;
  while (instantTimestamps.length && instantTimestamps[0] < cutoff) instantTimestamps.shift();
  if (instantTimestamps.length >= config.notify.instantPerMinute) {
    return { allowed: false, reason: 'rate_limit' };
  }
  lastInstantAt.set(key, now);
  instantTimestamps.push(now);
  return { allowed: true };
}

/** 落库 + 广播 + 分发通道（即时提醒专用） */
async function persistAndDispatch(
  n: db.DbNotification,
  opts: Pick<NotifyCommon, 'channels' | 'emailTo' | 'smtp'>
): Promise<void> {
  db.createNotification(n);

  // 广播给前端
  eventBus.emitEvent({
    type: 'instant',
    groupId: n.group_id,
    notificationId: n.id,
    title: n.title,
    priority: n.priority,
  });

  // 通道分发
  const channels: NotifyChannel[] = opts.channels?.length ? opts.channels : ['console'];
  for (const channel of channels) {
    if (channel === 'console') {
      db.createPushLog({
        id: uuidv4(),
        notification_id: n.id,
        channel: 'console',
        status: 'success',
        detail: '站内通知',
        sent_at: new Date().toISOString(),
      });
      continue;
    }
    if (channel === 'email') {
      if (!opts.emailTo || !isEmailConfigured(opts.smtp)) {
        db.createPushLog({
          id: uuidv4(),
          notification_id: n.id,
          channel: 'email',
          status: 'failed',
          detail: !opts.emailTo ? '未配置收件人' : '未配置 SMTP',
          sent_at: new Date().toISOString(),
        });
        continue;
      }
      const res = await sendEmail({
        to: opts.emailTo,
        subject: n.title,
        html: `<h2>${n.title}</h2><pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(n.body)}</pre>`,
        runtime: opts.smtp,
      });
      db.createPushLog({
        id: uuidv4(),
        notification_id: n.id,
        channel: 'email',
        status: res.ok ? 'success' : 'failed',
        detail: res.detail || (res.ok ? '已发送' : '发送失败'),
        sent_at: new Date().toISOString(),
      });
    }
  }
}

/**
 * 即时提醒（高优先级消息）
 * @returns 是否真正发出（可能因节流被丢弃）
 */
export async function notifyInstant(params: {
  groupId: string;
  groupName?: string | null;
  ruleId: string;
  ruleName: string;
  priority: number;
  message: db.DbGroupMessage;
  channels?: NotifyChannel[];
  emailTo?: string | null;
  smtp?: Partial<SmtpOptions>;
}): Promise<boolean> {
  const key = `${params.groupId}:${params.ruleId}`;
  const gate = instantAllowed(key);
  if (!gate.allowed) {
    return false;
  }

  const n: db.DbNotification = {
    id: uuidv4(),
    type: 'instant',
    title: `【高优先级】${params.groupName || '群聊'} · ${params.ruleName}`,
    body: `${params.message.sender_name || params.message.sender_id || '未知'}：${params.message.content}`,
    group_id: params.groupId,
    summary_id: null,
    priority: params.priority,
    read: 0,
    channels: JSON.stringify(params.channels?.length ? params.channels : ['console']),
    created_at: new Date().toISOString(),
  };

  await persistAndDispatch(n, {
    channels: params.channels,
    emailTo: params.emailTo,
    smtp: params.smtp,
  });
  return true;
}

/** 总结完成通知 */
export async function notifySummary(params: {
  groupId: string;
  groupName?: string | null;
  summaryId: string;
  title: string;
  body: string;
  priority?: number;
  channels?: NotifyChannel[];
  emailTo?: string | null;
  smtp?: Partial<SmtpOptions>;
}): Promise<string> {
  const n: db.DbNotification = {
    id: uuidv4(),
    type: 'summary',
    title: params.title,
    body: params.body,
    group_id: params.groupId,
    summary_id: params.summaryId,
    priority: params.priority ?? 50,
    read: 0,
    channels: JSON.stringify(params.channels?.length ? params.channels : ['console']),
    created_at: new Date().toISOString(),
  };

  db.createNotification(n);
  eventBus.emitEvent({
    type: 'summary',
    groupId: params.groupId,
    summaryId: params.summaryId,
    title: params.title,
    status: 'done',
  });

  const channels: NotifyChannel[] = params.channels?.length ? params.channels : ['console'];
  for (const channel of channels) {
    if (channel === 'console') {
      db.createPushLog({
        id: uuidv4(),
        notification_id: n.id,
        channel: 'console',
        status: 'success',
        detail: '站内通知',
        sent_at: new Date().toISOString(),
      });
    } else if (channel === 'email') {
      if (!params.emailTo || !isEmailConfigured(params.smtp)) {
        db.createPushLog({
          id: uuidv4(),
          notification_id: n.id,
          channel: 'email',
          status: 'failed',
          detail: !params.emailTo ? '未配置收件人' : '未配置 SMTP',
          sent_at: new Date().toISOString(),
        });
        continue;
      }
      const res = await sendEmail({
        to: params.emailTo,
        subject: params.title,
        html: `<h2>${params.title}</h2><pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(params.body)}</pre>`,
        runtime: params.smtp,
      });
      db.createPushLog({
        id: uuidv4(),
        notification_id: n.id,
        channel: 'email',
        status: res.ok ? 'success' : 'failed',
        detail: res.detail || (res.ok ? '已发送' : '发送失败'),
        sent_at: new Date().toISOString(),
      });
    }
  }
  return n.id;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
