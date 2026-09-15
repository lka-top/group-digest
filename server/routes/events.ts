/**
 * 全局实时事件端点（SSE）
 *
 * 与模板的请求级 SSE（/api/chat）不同，这里是「一连接持续广播所有实时事件」：
 * 新消息、新总结、即时提醒、适配器状态变化。
 */
import { Router } from 'express';
import type { Response } from 'express';
import eventBus, { type AppEvent } from '../eventBus.js';

export const eventsRouter = Router();

const clients = new Set<Response>();

eventsRouter.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify({ type: 'hello', ts: Date.now() })}\n\n`);
  clients.add(res);

  const unsubscribe = eventBus.onEvent((event: AppEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  const heartbeat = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      /* ignore */
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    clients.delete(res);
    res.end();
  });
});

/** 当前 SSE 连接数（供看板展示） */
export function getEventClientCount(): number {
  return clients.size;
}
