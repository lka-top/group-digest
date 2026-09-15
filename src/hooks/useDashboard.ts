import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../api';
import type { DashboardData } from '../types';

export function useDashboard(refreshKey = 0) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiGet<DashboardData>('/api/dashboard'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return { data, loading, error, refresh };
}
