/**
 * 通知路由
 */
import { Router } from 'express';
import * as db from '../db.js';

export const notificationsRouter = Router();

/** 通知列表 */
notificationsRouter.get('/', (req, res) => {
  const unreadOnly = req.query.unreadOnly === 'true' || req.query.unreadOnly === '1';
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  res.json({
    notifications: db.getNotifications({ unreadOnly, limit }),
    unread: db.countUnreadNotifications(),
  });
});

/** 标记单条已读 */
notificationsRouter.patch('/:id/read', (req, res) => {
  const ok = db.markNotificationRead(req.params.id);
  res.json({ ok, unread: db.countUnreadNotifications() });
});

/** 全部已读 */
notificationsRouter.post('/read-all', (_req, res) => {
  const changed = db.markAllNotificationsRead();
  res.json({ ok: true, changed, unread: 0 });
});
