import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiSend } from '../api';
import type { PriorityRule } from '../types';

export interface PriorityRuleInput {
  name: string;
  scope_type: 'global' | 'group';
  group_id?: string | null;
  match_type: 'keyword' | 'sender' | 'regex';
  pattern: string;
  priority?: number;
  action?: 'instant_notify' | 'boost_summary';
  enabled?: boolean;
}

export function usePriorities(refreshKey = 0) {
  const [rules, setRules] = useState<PriorityRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ rules: PriorityRule[] }>('/api/priorities');
      setRules(res.rules);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const create = useCallback(
    async (input: PriorityRuleInput) => {
      await apiSend('/api/priorities', 'POST', input);
      await refresh();
    },
    [refresh]
  );

  const update = useCallback(
    async (id: string, input: Partial<PriorityRuleInput>) => {
      await apiSend(`/api/priorities/${id}`, 'PATCH', input);
      await refresh();
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      await apiSend(`/api/priorities/${id}`, 'DELETE');
      await refresh();
    },
    [refresh]
  );

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return { rules, loading, error, refresh, create, update, remove };
}
