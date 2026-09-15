/**
 * 定时总结调度器（node-cron）
 *
 * 从 schedules 表加载启用的计划，按 cron 表达式 + 时区注册任务；
 * 每次执行对目标群（单群或全部启用群）生成指定时间窗的总结并推送。
 * CRUD 变更后调用 reload() 重建任务。
 */
import cron, { type ScheduledTask } from 'node-cron';
import * as db from './db.js';
import config from './config.js';
import { generateSummary } from './summary/engine.js';
import { notifySummary, type NotifyChannel } from './notify/dispatcher.js';
import { formatRange } from './summary/prompt.js';

type Task = { id: string; task: ScheduledTask };

let tasks: Task[] = [];
const runningKeys = new Set<string>();
let runningCount = 0;
const MAX_CONCURRENT = 3;

function parseChannels(raw: string | null): NotifyChannel[] {
  if (!raw) return ['console'];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed as NotifyChannel[];
  } catch {
    /* ignore */
  }
  return ['console'];
}

/** 计算计划下次运行时间（尽力而为，取不到则为 null） */
function computeNextRun(task: ScheduledTask): string | null {
  try {
    const anyTask = task as unknown as { nextDates?: (n?: number) => Date[] };
    if (typeof anyTask.nextDates === 'function') {
      const dates = anyTask.nextDates(1);
      if (dates && dates[0]) return dates[0].toISOString();
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 执行一次计划 */
async function runSchedule(schedule: db.DbSchedule): Promise<void> {
  const runKey = schedule.id;
  if (runningKeys.has(runKey)) {
    console.log(`[scheduler] 计划「${schedule.name}」上一次仍在执行，跳过本次触发`);
    return;
  }
  if (runningCount >= MAX_CONCURRENT) {
    console.log('[scheduler] 并发已达上限，跳过本次触发');
    return;
  }

  runningKeys.add(runKey);
  runningCount += 1;
  const startedAt = new Date();
  db.updateSchedule(schedule.id, { last_run: startedAt.toISOString(), last_status: 'running' });

  try {
    const groupIds = schedule.group_id ? [schedule.group_id] : db.getSummaryEnabledGroupIds();
    const windowMs = Math.max(1, schedule.window_minutes) * 60 * 1000;
    const end = new Date();
    const requestedStart = new Date(end.getTime() - windowMs);
    const channels = parseChannels(schedule.channels);

    for (const groupId of groupIds) {
      const cfg = db.getGroupConfig(groupId);
      if (cfg.enabled !== 1 || cfg.summary_enabled !== 1) continue;
      // 自动总结始终服从最近一次授权边界，避免误带入主动回填的授权前历史。
      const start =
        cfg.authorized_at && Date.parse(cfg.authorized_at) > requestedStart.getTime()
          ? new Date(cfg.authorized_at)
          : requestedStart;

      const result = await generateSummary({
        groupId,
        start: start.toISOString(),
        end: end.toISOString(),
        triggerType: 'schedule',
        scheduleId: schedule.id,
      });

      if (result.status === 'done' && cfg.push_enabled === 1) {
        const group = db.getGroupById(groupId);
        await notifySummary({
          groupId,
          groupName: group?.name,
          summaryId: result.summaryId,
          title: `定时总结 · ${group?.name || '群聊'}（${formatRange(start.toISOString())} ~ ${formatRange(end.toISOString())}）`,
          body: result.contentMd,
          priority: cfg.priority,
          channels,
          emailTo: schedule.email_to,
        });
      }
    }

    db.updateSchedule(schedule.id, { last_status: 'ok' });
  } catch (err) {
    console.error(`[scheduler] 计划「${schedule.name}」执行失败:`, err);
    db.updateSchedule(schedule.id, { last_status: 'failed' });
  } finally {
    runningKeys.delete(runKey);
    runningCount -= 1;
  }
}

/** 停止所有任务 */
export function stopScheduler(): void {
  for (const t of tasks) {
    try {
      t.task.stop();
    } catch {
      /* ignore */
    }
  }
  tasks = [];
}

/** 重新加载所有计划 */
export function reloadScheduler(): void {
  stopScheduler();
  const schedules = db.getSchedules(true);
  for (const schedule of schedules) {
    if (!cron.validate(schedule.cron)) {
      console.warn(`[scheduler] 非法 cron 表达式，已跳过计划「${schedule.name}」: ${schedule.cron}`);
      db.updateSchedule(schedule.id, { last_status: 'invalid_cron' });
      continue;
    }
    const task = cron.schedule(
      schedule.cron,
      () => {
        const latest = db.getSchedule(schedule.id);
        if (latest && latest.enabled === 1) void runSchedule(latest);
      },
      { timezone: schedule.timezone || config.timezone }
    );
    tasks.push({ id: schedule.id, task });

    const nextRun = computeNextRun(task);
    db.updateSchedule(schedule.id, { next_run: nextRun });
  }
  console.log(`[scheduler] 已加载 ${tasks.length} 个定时计划`);
}

/** 启动调度器 */
export function startScheduler(): void {
  reloadScheduler();
}
