import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiSend } from '../api';
import type { Group, GroupProcessingMode } from '../types';

export function useGroups(refreshKey = 0) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ groups: Group[] }>('/api/groups');
      setGroups(res.groups);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const updateConfig = useCallback(
    async (
      groupId: string,
      updates: {
        processing_mode?: GroupProcessingMode;
        enabled?: boolean;
        priority?: number;
        summary_enabled?: boolean;
        push_enabled?: boolean;
      }
    ) => {
      await apiSend(`/api/groups/${groupId}/config`, 'PATCH', updates);
      await refresh();
    },
    [refresh]
  );

  const updatePolicyByScope = useCallback(
    async (
      target:
        | { scope: 'all' }
        | { scope: 'platform'; platform: string }
        | { scope: 'account'; platform_account_id: string },
      updates: { processing_mode?: GroupProcessingMode; priority?: number }
    ) => {
      const result = await apiSend<{ ok: boolean; matched: number; updated: number }>(
        '/api/groups/config/bulk',
        'PATCH',
        { ...target, ...updates }
      );
      await refresh();
      return result;
    },
    [refresh]
  );

  const inheritPolicy = useCallback(
    async (groupId: string) => {
      await apiSend(`/api/groups/${groupId}/inherit`, 'POST');
      await refresh();
    },
    [refresh]
  );

  const sync = useCallback(async () => {
    const res = await apiSend<{
      ok: boolean;
      total: number;
      created: number;
      updated: number;
      accounts?: number;
      failedAccounts?: string[];
    }>(
      '/api/groups/sync',
      'POST'
    );
    await refresh();
    return res;
  }, [refresh]);

  const backfillHistory = useCallback(
    async (groupId: string, count = 100) => {
      const res = await apiSend<{
        ok: boolean;
        fetched: number;
        stored: number;
        skipped: { disabled: number; before_authorization: number; duplicate: number; empty: number };
      }>(`/api/groups/${groupId}/history`, 'POST', { count });
      await refresh();
      return res;
    },
    [refresh]
  );

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return { groups, loading, error, refresh, updateConfig, updatePolicyByScope, inheritPolicy, sync, backfillHistory };
}
