/**
 * 明确授权的群历史回填。
 *
 * 此模块只负责分页读取、按时间范围落库和统计；是否允许触发回填由调用方决定。
 */
import type { PlatformAdapter, UnifiedMessage } from '../adapters/types.js';
import type { GroupWithConfig } from '../db.js';
import { ingest, type IngestResult } from './pipeline.js';

export interface HistoryBackfillProgress {
  page: number;
  fetched: number;
  stored: number;
  earliestTimestamp: string | null;
}

export interface HistoryBackfillResult extends HistoryBackfillProgress {
  reachedStart: boolean;
  exhausted: boolean;
  limitReached: boolean;
  skipped: Record<NonNullable<IngestResult['skipped']>, number>;
}

export interface BackfillHistoryRangeOptions {
  adapter: PlatformAdapter;
  group: GroupWithConfig;
  start: string;
  end: string;
  pageSize?: number;
  maxPages?: number;
  onProgress?: (progress: HistoryBackfillProgress) => void;
}

/**
 * 从最新消息开始向前分页，直到覆盖 start。只把 [start, end] 内的消息写入数据库。
 * 重复消息由数据库唯一键去重，因此中断后重试是安全的。
 */
export async function backfillHistoryRange(
  options: BackfillHistoryRangeOptions
): Promise<HistoryBackfillResult> {
  const { adapter, group, start, end, onProgress } = options;
  if (adapter.platform !== group.platform) {
    throw new Error(`当前适配器无法读取 ${group.platform} 群历史`);
  }
  const accountConnected = adapter
    .getAccounts()
    .some((account) => account.selfId === group.account_self_id && account.status === 'connected');
  if (group.account_self_id && !accountConnected) {
    throw new Error(`该群属于账号 ${group.account_self_id}，该账号当前未连接，无法回填历史消息`);
  }
  if (!adapter.getGroupHistory) {
    throw new Error('当前平台适配器不支持历史消息回填');
  }

  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    throw new Error('历史回填时间范围无效');
  }

  const pageSize = Math.min(200, Math.max(1, options.pageSize ?? 100));
  const maxPages = Math.min(500, Math.max(1, options.maxPages ?? 200));
  const skipped: HistoryBackfillResult['skipped'] = {
    disabled: 0,
    before_authorization: 0,
    duplicate: 0,
    empty: 0,
  };
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let page = 0;
  let fetched = 0;
  let stored = 0;
  let earliestMs = Number.POSITIVE_INFINITY;
  let reachedStart = false;
  let exhausted = false;

  while (page < maxPages) {
    const messages = await adapter.getGroupHistory(
      group.platform_group_id,
      {
        count: pageSize,
        beforeMessageId: cursor,
      },
      group.account_self_id || undefined
    );
    page += 1;

    if (messages.length === 0) {
      exhausted = true;
      break;
    }

    fetched += messages.length;
    let oldest: UnifiedMessage | undefined;
    for (const message of messages) {
      if (!oldest || message.timestamp < oldest.timestamp) oldest = message;
      earliestMs = Math.min(earliestMs, message.timestamp);
      if (message.timestamp < startMs || message.timestamp > endMs) continue;

      const result = await ingest(message, { source: 'backfill' });
      if (result.stored) stored += 1;
      else if (result.skipped) skipped[result.skipped] += 1;
    }

    onProgress?.({
      page,
      fetched,
      stored,
      earliestTimestamp: Number.isFinite(earliestMs) ? new Date(earliestMs).toISOString() : null,
    });

    if (earliestMs <= startMs) {
      reachedStart = true;
      break;
    }

    const nextCursor = oldest?.platformMessageId;
    if (!nextCursor || nextCursor === cursor || seenCursors.has(nextCursor)) {
      exhausted = true;
      break;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return {
    page,
    fetched,
    stored,
    earliestTimestamp: Number.isFinite(earliestMs) ? new Date(earliestMs).toISOString() : null,
    reachedStart,
    exhausted,
    limitReached: !reachedStart && !exhausted && page >= maxPages,
    skipped,
  };
}
