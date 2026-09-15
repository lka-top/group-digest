import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiSend } from '../api';
import type { Schedule } from '../types';

export interface ScheduleInput {
  name: string;
  group_id?: string | null;
  cron: string;
  timezone?: string;
  window_minutes?: number;
  channels?: string[];
  email_to?: string | null;
  enabled?: boolean;
}

export function useSchedules(refreshKey = 0) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ schedules: Schedule[] }>('/api/schedules');
      setSchedules(res.schedules);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const create = useCallback(
    async (input: ScheduleInput) => {
      await apiSend('/api/schedules', 'POST', input);
      await refresh();
    },
    [refresh]
  );

  const update = useCallback(
    async (id: string, input: Partial<ScheduleInput>) => {
      await apiSend(`/api/schedules/${id}`, 'PATCH', input);
      await refresh();
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      await apiSend(`/api/schedules/${id}`, 'DELETE');
      await refresh();
    },
    [refresh]
  );

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return { schedules, loading, error, refresh, create, update, remove };
}
