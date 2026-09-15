/**
 * 群消息查询路由
 */
import { Router } from 'express';
import * as db from '../db.js';
import { asFiniteNumber, isValidDate } from './validation.js';

export const messagesRouter = Router();

/** 按群 + 时间窗 + 关键词分页查询群消息 */
messagesRouter.get('/', (req, res) => {
  try {
    const { platform, platformAccountId, groupId, start, end, keyword, page, pageSize, order } = req.query;
    const parsedPage = page === undefined ? undefined : asFiniteNumber(page, { integer: true, min: 1 });
    const parsedPageSize =
      pageSize === undefined ? undefined : asFiniteNumber(pageSize, { integer: true, min: 1, max: 500 });
    if ((page !== undefined && parsedPage === undefined) || (pageSize !== undefined && parsedPageSize === undefined)) {
      return res.status(400).json({ error: 'page 必须为正整数，pageSize 必须是 1~500 的整数' });
    }
    if ((start !== undefined && !isValidDate(start)) || (end !== undefined && !isValidDate(end))) {
      return res.status(400).json({ error: 'start / end 必须是有效日期' });
    }
    if (isValidDate(start) && isValidDate(end) && Date.parse(start) > Date.parse(end)) {
      return res.status(400).json({ error: 'start 不能晚于 end' });
    }
    const result = db.queryGroupMessages({
      platform: typeof platform === 'string' && platform ? platform : undefined,
      platformAccountId:
        typeof platformAccountId === 'string' && platformAccountId ? platformAccountId : undefined,
      groupId: typeof groupId === 'string' && groupId ? groupId : undefined,
      start: typeof start === 'string' && start ? start : undefined,
      end: typeof end === 'string' && end ? end : undefined,
      keyword: typeof keyword === 'string' && keyword ? keyword : undefined,
      page: parsedPage,
      pageSize: parsedPageSize,
      order: order === 'asc' ? 'asc' : 'desc',
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
