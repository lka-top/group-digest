import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiSend } from '../api';
import type { AppNotification } from '../types';

export function useNotifications(refreshKey = 0) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ notifications: AppNotification[]; unread: number }>(
        '/api/notifications?limit=200'
      );
      setNotifications(res.notifications);
      setUnread(res.unread);
    } catch {
      /* 静默失败，避免打断页面 */
    } finally {
      setLoading(false);
    }
  }, []);

  const markRead = useCallback(async (id: string) => {
    await apiSend(`/api/notifications/${id}/read`, 'PATCH');
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: 1 } : n)));
    setUnread((prev) => Math.max(0, prev - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    await apiSend('/api/notifications/read-all', 'POST');
    setNotifications((prev) => prev.map((n) => ({ ...n, read: 1 })));
    setUnread(0);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return { notifications, unread, loading, refresh, markRead, markAllRead, setUnread };
}
