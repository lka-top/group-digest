import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../api';
import type { Summary } from '../types';

export interface GenerateOptions {
  groupId: string;
  start?: string;
  end?: string;
  windowMinutes?: number;
  allowBackfill?: boolean;
  onProgress?: (chunk: string) => void;
  onDone?: (result: { summaryId: string; status: string; contentMd: string; error?: string }) => void;
  onError?: (message: string) => void;
}

export function useSummaries(refreshKey = 0) {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ items: Summary[]; total: number }>('/api/summaries?pageSize=100');
      setSummaries(res.items);
      setTotal(res.total);
    } catch {
      /* 静默 */
    } finally {
      setLoading(false);
    }
  }, []);

  /** 手动一键总结（SSE 流式） */
  const generate = useCallback(async (opts: GenerateOptions) => {
    setGenerating(true);
    try {
      const res = await fetch('/api/summaries/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: opts.groupId,
          start: opts.start,
          end: opts.end,
          windowMinutes: opts.windowMinutes,
          allowBackfill: opts.allowBackfill,
          triggerType: 'manual',
        }),
      });

      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error || `请求失败: ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('服务器未返回可读取的总结流');

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'progress') opts.onProgress?.(data.content);
            else if (data.type === 'done') {
              opts.onDone?.({
                summaryId: data.summaryId,
                status: data.status,
                contentMd: data.contentMd,
                error: data.error,
              });
            } else if (data.type === 'error') opts.onError?.(data.message);
          } catch {
            /* 忽略 */
          }
        }
      }
    } catch (err) {
      opts.onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return { summaries, total, loading, generating, refresh, generate };
}
