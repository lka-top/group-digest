/**
 * 优先级规则路由
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db.js';
import { asBooleanInt, asFiniteNumber, asTrimmedString } from './validation.js';

export const prioritiesRouter = Router();

prioritiesRouter.get('/', (_req, res) => {
  res.json({ rules: db.getPriorityRules() });
});

prioritiesRouter.post('/', (req, res) => {
  const { name, scope_type, group_id, match_type, pattern, priority, action, enabled } = req.body ?? {};
  const parsedName = asTrimmedString(name);
  const parsedPattern = asTrimmedString(pattern);
  const parsedPriority = priority === undefined ? 100 : asFiniteNumber(priority, { integer: true, min: 0, max: 999 });
  const parsedEnabled = enabled === undefined ? 1 : asBooleanInt(enabled);
  if (!parsedName || !parsedPattern) {
    return res.status(400).json({ error: 'name 与 pattern 必填' });
  }
  if (!['global', 'group'].includes(scope_type)) return res.status(400).json({ error: 'scope_type 无效' });
  if (!['keyword', 'sender', 'regex'].includes(match_type)) return res.status(400).json({ error: 'match_type 无效' });
  if (!['instant_notify', 'boost_summary'].includes(action)) return res.status(400).json({ error: 'action 无效' });
  if (parsedPriority === undefined) return res.status(400).json({ error: 'priority 必须是 0~999 的整数' });
  if (parsedEnabled === undefined) return res.status(400).json({ error: 'enabled 格式无效' });
  if (scope_type === 'group' && (!group_id || !db.getGroupById(String(group_id)))) {
    return res.status(400).json({ error: '群范围规则必须指定有效群' });
  }
  if (match_type === 'regex') {
    try {
      new RegExp(parsedPattern);
    } catch {
      return res.status(400).json({ error: '正则表达式无效' });
    }
  }
  const now = new Date().toISOString();
  const rule: db.DbPriorityRule = {
    id: uuidv4(),
    name: parsedName,
    scope_type,
    group_id: scope_type === 'group' ? group_id ?? null : null,
    match_type,
    pattern: parsedPattern,
    priority: parsedPriority,
    action,
    enabled: parsedEnabled,
    created_at: now,
    updated_at: now,
  };
  db.createPriorityRule(rule);
  res.json({ ok: true, rule });
});

prioritiesRouter.patch('/:id', (req, res) => {
  const existing = db.getPriorityRule(req.params.id);
  if (!existing) return res.status(404).json({ error: '规则不存在' });
  const source = req.body ?? {};
  const updates: Partial<Omit<db.DbPriorityRule, 'id' | 'created_at' | 'updated_at'>> = {};

  if (source.name !== undefined) {
    const name = asTrimmedString(source.name);
    if (!name) return res.status(400).json({ error: 'name 不能为空' });
    updates.name = name;
  }
  if (source.pattern !== undefined) {
    const pattern = asTrimmedString(source.pattern);
    if (!pattern) return res.status(400).json({ error: 'pattern 不能为空' });
    updates.pattern = pattern;
  }
  if (source.scope_type !== undefined) {
    if (!['global', 'group'].includes(source.scope_type)) return res.status(400).json({ error: 'scope_type 无效' });
    updates.scope_type = source.scope_type;
  }
  if (source.match_type !== undefined) {
    if (!['keyword', 'sender', 'regex'].includes(source.match_type)) return res.status(400).json({ error: 'match_type 无效' });
    updates.match_type = source.match_type;
  }
  if (source.action !== undefined) {
    if (!['instant_notify', 'boost_summary'].includes(source.action)) return res.status(400).json({ error: 'action 无效' });
    updates.action = source.action;
  }
  if (source.priority !== undefined) {
    const priority = asFiniteNumber(source.priority, { integer: true, min: 0, max: 999 });
    if (priority === undefined) return res.status(400).json({ error: 'priority 必须是 0~999 的整数' });
    updates.priority = priority;
  }
  if (source.enabled !== undefined) {
    const enabled = asBooleanInt(source.enabled);
    if (enabled === undefined) return res.status(400).json({ error: 'enabled 格式无效' });
    updates.enabled = enabled;
  }

  const scopeType = updates.scope_type ?? existing.scope_type;
  const groupId = source.group_id !== undefined ? source.group_id : existing.group_id;
  if (scopeType === 'group') {
    if (!groupId || !db.getGroupById(String(groupId))) return res.status(400).json({ error: '群范围规则必须指定有效群' });
    if (source.group_id !== undefined || updates.scope_type === 'group') updates.group_id = String(groupId);
  } else if (source.group_id !== undefined || updates.scope_type === 'global') {
    updates.group_id = null;
  }

  const matchType = updates.match_type ?? existing.match_type;
  const pattern = updates.pattern ?? existing.pattern;
  if (matchType === 'regex') {
    try {
      new RegExp(pattern);
    } catch {
      return res.status(400).json({ error: '正则表达式无效' });
    }
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: '没有可更新的规则字段' });
  const ok = db.updatePriorityRule(req.params.id, updates);
  res.json({ ok: true });
});

prioritiesRouter.delete('/:id', (req, res) => {
  const ok = db.deletePriorityRule(req.params.id);
  if (!ok) return res.status(404).json({ error: '规则不存在' });
  res.json({ ok });
});
