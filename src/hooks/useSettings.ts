import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiSend } from '../api';

export interface AppSettings {
  runtime: {
    adapter: string;
    adapterStatus: string;
    adapterAccounts: Array<{ selfId: string; displayName?: string; status: string }>;
    port: number;
    timezone: string;
    aiConfigured: boolean;
    aiProvider: string;
  };
  ai: {
    provider: 'codebuddy' | 'openai-compatible' | 'ollama';
    baseUrl: string;
    model: string;
    apiKeySet: boolean;
    apiKey: string;
  };
  onebot: {
    mode: string;
    wsPort: number;
    wsPath: string;
    napcatWsUrl: string;
    httpBaseUrl: string;
    tokenSet: boolean;
    token: string;
  };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    passSet: boolean;
    pass: string;
    from: string;
  };
}

export function useSettings(refreshKey = 0) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSettings(await apiGet<AppSettings>('/api/settings'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(
    async (payload: { adapter?: string; ai?: unknown; onebot?: unknown; smtp?: unknown }) => {
      const res = await apiSend<{ ok: boolean; note?: string }>('/api/settings', 'POST', payload);
      await refresh();
      return res;
    },
    [refresh]
  );

  const testEmail = useCallback(async (payload?: unknown) => {
    return apiSend<{ ok: boolean; detail?: string }>('/api/settings/test-email', 'POST', payload ?? {});
  }, []);

  const testAi = useCallback(async (payload?: unknown) => {
    return apiSend<{ ok: boolean; detail?: string }>('/api/settings/test-ai', 'POST', payload ?? {});
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return { settings, loading, error, refresh, save, testEmail, testAi };
}
