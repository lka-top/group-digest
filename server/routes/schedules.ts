/**
 * 定时计划路由（CRUD 后自动重载调度器）
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db.js';
import config from '../config.js';
import { reloadScheduler } from '../scheduler.js';
import cron from 'node-cron';
import { asBooleanInt, asFiniteNumber, asTrimmedString, isValidTimezone } from './validation.js';

export const schedulesRouter = Router();

const ALLOWED_CHANNELS = new Set(['console', 'email']);

function validateChannels(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const channels = [...new Set(value)];
  return channels.every((channel): channel is string => typeof channel === 'string' && ALLOWED_CHANNELS.has(channel))
    ? channels
    : undefined;
}

schedulesRouter.get('/', (_req, res) => {
  res.json({ schedules: db.getSchedules(), timezone: config.timezone });
});

schedulesRouter.post('/', (req, res) => {
  const { name, group_id, cron: cronExpr, timezone, window_minutes, channels, email_to, enabled } = req.body ?? {};
  const parsedName = asTrimmedString(name);
  const parsedCron = asTrimmedString(cronExpr);
  const parsedTimezone = asTrimmedString(timezone) || config.timezone;
  const parsedWindow =
    window_minutes === undefined
      ? config.summary.defaultWindowMinutes
      : asFiniteNumber(window_minutes, { integer: true, min: 1, max: 525_600 });
  const parsedChannels = channels === undefined ? ['console'] : validateChannels(channels);
  const parsedEnabled = enabled === undefined ? 1 : asBooleanInt(enabled);
  if (!parsedName || !parsedCron) {
    return res.status(400).json({ error: 'name 与 cron 必填' });
  }
  if (!cron.validate(parsedCron)) return res.status(400).json({ error: 'cron 表达式无效' });
  if (!isValidTimezone(parsedTimezone)) return res.status(400).json({ error: 'timezone 无效' });
  if (parsedWindow === undefined) return res.status(400).json({ error: 'window_minutes 必须是正整数' });
  if (!parsedChannels) return res.status(400).json({ error: 'channels 仅支持 console / email' });
  if (parsedEnabled === undefined) return res.status(400).json({ error: 'enabled 格式无效' });
  if (group_id && !db.getGroupById(String(group_id))) return res.status(400).json({ error: '指定群不存在' });
  if (parsedChannels.includes('email') && !asTrimmedString(email_to)) {
    return res.status(400).json({ error: '邮件通道必须配置 email_to' });
  }
  const now = new Date().toISOString();
  const schedule: db.DbSchedule = {
    id: uuidv4(),
    name: parsedName,
    group_id: group_id || null,
    cron: parsedCron,
    timezone: parsedTimezone,
    window_minutes: parsedWindow,
    channels: JSON.stringify(parsedChannels),
    email_to: email_to || null,
    enabled: parsedEnabled,
    last_run: null,
    next_run: null,
    last_status: null,
    created_at: now,
    updated_at: now,
  };
  db.createSchedule(schedule);
  reloadScheduler();
  res.json({ ok: true, schedule });
});

schedulesRouter.patch('/:id', (req, res) => {
  const existing = db.getSchedule(req.params.id);
  if (!existing) return res.status(404).json({ error: '计划不存在' });
  const body = { ...(req.body ?? {}) };
  if (body.name !== undefined) {
    const name = asTrimmedString(body.name);
    if (!name) return res.status(400).json({ error: 'name 不能为空' });
    body.name = name;
  }
  if (body.cron !== undefined) {
    const cronExpr = asTrimmedString(body.cron);
    if (!cronExpr || !cron.validate(cronExpr)) return res.status(400).json({ error: 'cron 表达式无效' });
    body.cron = cronExpr;
  }
  if (body.timezone !== undefined) {
    const timezone = asTrimmedString(body.timezone);
    if (!timezone || !isValidTimezone(timezone)) return res.status(400).json({ error: 'timezone 无效' });
    body.timezone = timezone;
  }
  if (body.group_id && !db.getGroupById(String(body.group_id))) {
    return res.status(400).json({ error: '指定群不存在' });
  }
  if (body.channels !== undefined) {
    const parsedChannels = validateChannels(body.channels);
    if (!parsedChannels) return res.status(400).json({ error: 'channels 仅支持 console / email' });
    const emailTo = asTrimmedString(body.email_to) || existing.email_to || undefined;
    if (parsedChannels.includes('email') && !emailTo) {
      return res.status(400).json({ error: '邮件通道必须配置 email_to' });
    }
    body.channels = JSON.stringify(parsedChannels);
  }
  if (body.enabled !== undefined) {
    const enabled = asBooleanInt(body.enabled);
    if (enabled === undefined) return res.status(400).json({ error: 'enabled 格式无效' });
    body.enabled = enabled;
  }
  if (body.window_minutes !== undefined) {
    const windowMinutes = asFiniteNumber(body.window_minutes, { integer: true, min: 1, max: 525_600 });
    if (windowMinutes === undefined) return res.status(400).json({ error: 'window_minutes 必须是正整数' });
    body.window_minutes = windowMinutes;
  }

  const ok = db.updateSchedule(req.params.id, body);
  if (!ok) return res.status(404).json({ error: '计划不存在或无可更新字段' });
  reloadScheduler();
  res.json({ ok: true });
});

schedulesRouter.delete('/:id', (req, res) => {
  const ok = db.deleteSchedule(req.params.id);
  if (!ok) return res.status(404).json({ error: '计划不存在' });
  reloadScheduler();
  res.json({ ok });
});
