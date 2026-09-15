import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../api';
import type { GroupMessage } from '../types';

export interface MessageFilters {
  platform?: string;
  platformAccountId?: string;
  groupId?: string;
  start?: string;
  end?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
  order?: 'asc' | 'desc';
}

export function useMessages(filters: MessageFilters, refreshKey = 0) {
  const [items, setItems] = useState<GroupMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.platform) params.set('platform', filters.platform);
      if (filters.platformAccountId) params.set('platformAccountId', filters.platformAccountId);
      if (filters.groupId) params.set('groupId', filters.groupId);
      if (filters.start) params.set('start', filters.start);
      if (filters.end) params.set('end', filters.end);
      if (filters.keyword) params.set('keyword', filters.keyword);
      params.set('page', String(filters.page ?? 1));
      params.set('pageSize', String(filters.pageSize ?? 50));
      params.set('order', filters.order ?? 'desc');

      const res = await apiGet<{ items: GroupMessage[]; total: number }>(`/api/messages?${params.toString()}`);
      setItems(res.items);
      setTotal(res.total);
    } catch {
      /* 静默 */
    } finally {
      setLoading(false);
    }
  }, [
    filters.platform,
    filters.platformAccountId,
    filters.groupId,
    filters.start,
    filters.end,
    filters.keyword,
    filters.page,
    filters.pageSize,
    filters.order,
  ]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return { items, total, loading, refresh };
}
