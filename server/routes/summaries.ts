/**
 * 总结路由（列表 / 详情 / 手动一键生成）
 */
import { Router } from 'express';
import * as db from '../db.js';
import { generateSummary, defaultWindow } from '../summary/engine.js';
import { notifySummary } from '../notify/dispatcher.js';
import { formatRange } from '../summary/prompt.js';
import { asFiniteNumber, isValidDate } from './validation.js';
import { getAdapter } from '../adapters/index.js';
import { backfillHistoryRange } from '../ingest/history.js';

export const summariesRouter = Router();

/** 总结列表 */
summariesRouter.get('/', (req, res) => {
  try {
    const { groupId, page, pageSize } = req.query;
    const parsedPage = page === undefined ? undefined : asFiniteNumber(page, { integer: true, min: 1 });
    const parsedPageSize =
      pageSize === undefined ? undefined : asFiniteNumber(pageSize, { integer: true, min: 1, max: 200 });
    if ((page !== undefined && parsedPage === undefined) || (pageSize !== undefined && parsedPageSize === undefined)) {
      return res.status(400).json({ error: 'page 必须为正整数，pageSize 必须是 1~200 的整数' });
    }
    const result = db.getSummaries({
      groupId: typeof groupId === 'string' && groupId ? groupId : undefined,
      page: parsedPage,
      pageSize: parsedPageSize,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * 手动生成总结（SSE 流式返回）
 * body: { groupId, start?, end?, windowMinutes?, allowBackfill?, triggerType? }
 */
summariesRouter.post('/generate', async (req, res) => {
  const { groupId, start, end, windowMinutes, allowBackfill, triggerType } = req.body ?? {};
  if (!groupId) {
    return res.status(400).json({ error: 'groupId 必填' });
  }
  const group = db.getGroupById(groupId);
  if (!group) {
    return res.status(404).json({ error: '群不存在' });
  }
  if (group.enabled !== 1) {
    return res.status(400).json({ error: '该群当前未授权监控，请先开启“读取该群消息”' });
  }
  if (group.summary_enabled !== 1) {
    return res.status(400).json({ error: '该群处理模式未开启 AI 总结' });
  }

  const hasExplicitWindow = start !== undefined || end !== undefined;
  if (hasExplicitWindow && (!isValidDate(start) || !isValidDate(end))) {
    return res.status(400).json({ error: '同时提供有效的 start 与 end' });
  }
  if (isValidDate(start) && isValidDate(end) && Date.parse(start) > Date.parse(end)) {
    return res.status(400).json({ error: 'start 不能晚于 end' });
  }
  const parsedWindow =
    windowMinutes === undefined
      ? undefined
      : asFiniteNumber(windowMinutes, { integer: true, min: 1, max: 525_600 });
  if (windowMinutes !== undefined && parsedWindow === undefined) {
    return res.status(400).json({ error: 'windowMinutes 必须是 1~525600 的整数' });
  }
  if (allowBackfill !== undefined && typeof allowBackfill !== 'boolean') {
    return res.status(400).json({ error: 'allowBackfill 必须是布尔值' });
  }

  const explicitWindow = isValidDate(start) && isValidDate(end);
  const backfillPermitted = explicitWindow || allowBackfill === true;
  const win = explicitWindow ? { start, end } : defaultWindow(parsedWindow);
  // 相对时间窗默认遵循授权边界；用户显式许可后才可回填授权前历史。
  if (!backfillPermitted && group.authorized_at && Date.parse(win.start) < Date.parse(group.authorized_at)) {
    win.start = group.authorized_at;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  send({ type: 'start', groupId, groupName: group.name, start: win.start, end: win.end });

  try {
    const needsHistoricalBackfill =
      backfillPermitted && Boolean(group.authorized_at) && Date.parse(win.start) < Date.parse(group.authorized_at!);

    if (needsHistoricalBackfill) {
      send({
        type: 'progress',
        content: `> 开始自动回填：所选开始时间早于群聊授权时间，正在读取 ${formatRange(win.start)} 起的历史消息…\n\n`,
      });
      const backfill = await backfillHistoryRange({
        adapter: getAdapter(),
        group,
        start: win.start,
        end: win.end,
        onProgress: (progress) => {
          const earliest = progress.earliestTimestamp ? formatRange(progress.earliestTimestamp) : '未知';
          send({
            type: 'progress',
            content: `> 自动回填中：已读取 ${progress.fetched} 条，新增 ${progress.stored} 条，当前最早到 ${earliest}。\n\n`,
          });
        },
      });

      if (backfill.reachedStart) {
        send({
          type: 'progress',
          content: `> 自动回填完成：已覆盖所选开始时间，共读取 ${backfill.fetched} 条、新增 ${backfill.stored} 条。开始生成 AI 总结…\n\n`,
        });
      } else {
        const earliest = backfill.earliestTimestamp ? formatRange(backfill.earliestTimestamp) : '无可用历史消息';
        const reason = backfill.limitReached ? '已达到单次安全上限' : 'QQ/NapCat 未提供更早记录';
        send({
          type: 'progress',
          content: `> 自动回填结束：${reason}，当前最早可读取到 ${earliest}。将使用已取得的消息生成总结。\n\n`,
        });
      }
    }

    const result = await generateSummary({
      groupId,
      start: win.start,
      end: win.end,
      triggerType: triggerType === 'schedule' ? 'schedule' : 'manual',
      onProgress: (chunk) => send({ type: 'progress', content: chunk }),
    });

    // 生成成功后按群配置推送站内通知
    const cfg = db.getGroupConfig(groupId);
    if (result.status === 'done' && cfg.push_enabled === 1) {
      await notifySummary({
        groupId,
        groupName: group.name,
        summaryId: result.summaryId,
        title: `群总结 · ${group.name}（${formatRange(win.start)} ~ ${formatRange(win.end)}）`,
        body: result.contentMd,
        priority: cfg.priority,
        channels: ['console'],
      });
    }

    send({
      type: 'done',
      summaryId: result.summaryId,
      status: result.status,
      contentMd: result.contentMd,
      messageCount: result.messageCount,
      error: result.error,
    });
  } catch (err) {
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  } finally {
    res.end();
  }
});

/** 总结详情 */
summariesRouter.get('/:id', (req, res) => {
  const summary = db.getSummary(req.params.id);
  if (!summary) return res.status(404).json({ error: '总结不存在' });
  res.json({ summary });
});
