/**
 * AI 总结引擎
 *
 * 使用可配置的 AI 提供方生成结构化群聊总结。
 * 与模板的 Agent 对话 session 体系解耦：这里是一次性、无状态的总结任务，
 * 不写 sessions / messages 表。
 *
 * 流程：取时间窗消息 → 分片 → 构造提示词 → query() → 落库。
 * 消息量超阈值时采用 map-reduce 两段式（先分段摘要，再汇总）。
 */
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db.js';
import config from '../config.js';
import {
  buildSummaryPrompt,
  buildPartialPrompt,
  buildReducePrompt,
  chunkMessages,
  toPromptMessages,
} from './prompt.js';
import { getSummaryAiSettings, getSummaryProviderStatus, runSummaryQuery } from './provider.js';

export interface GenerateSummaryOptions {
  groupId: string;
  start: string;
  end: string;
  triggerType?: 'manual' | 'schedule' | 'instant';
  scheduleId?: string | null;
  model?: string;
  /** 流式进度回调（用于 SSE 推送给前端） */
  onProgress?: (chunk: string) => void;
}

export interface GenerateSummaryResult {
  summaryId: string;
  status: 'done' | 'failed';
  contentMd: string;
  error?: string;
  messageCount: number;
}

/** 向后兼容旧调用点；表示当前总结提供方是否已配置。 */
export function hasSdkCredentials(): boolean {
  return getSummaryProviderStatus().configured;
}

/**
 * 生成（并落库）某个群在指定时间窗内的总结
 */
export async function generateSummary(opts: GenerateSummaryOptions): Promise<GenerateSummaryResult> {
  const group = db.getGroupById(opts.groupId);
  if (!group) {
    throw new Error(`群不存在: ${opts.groupId}`);
  }

  const model = opts.model || getSummaryAiSettings().model;
  const now = new Date().toISOString();
  const summaryId = uuidv4();

  db.createSummary({
    id: summaryId,
    group_id: group.id,
    schedule_id: opts.scheduleId ?? null,
    trigger_type: opts.triggerType ?? 'manual',
    window_start: opts.start,
    window_end: opts.end,
    content_md: '',
    model,
    token_usage: null,
    status: 'generating',
    error: null,
    created_at: now,
  });

  const rows = db.getGroupMessagesForWindow(group.id, opts.start, opts.end);
  const messageCount = rows.length;

  // 无消息：直接给出空总结
  if (messageCount === 0) {
    const content = `# ${group.name} 群聊总结\n\n> 时间范围：${opts.start} ~ ${opts.end}\n\n该时间范围内没有消息记录。`;
    db.updateSummary(summaryId, { content_md: content, status: 'done' });
    return { summaryId, status: 'done', contentMd: content, messageCount: 0 };
  }

  // 缺少当前提供方的必要配置：优雅降级
  if (!hasSdkCredentials()) {
    const provider = getSummaryAiSettings().provider;
    const error = `AI 提供方「${provider}」尚未配置完整，无法生成总结`;
    db.updateSummary(summaryId, { status: 'failed', error });
    return { summaryId, status: 'failed', contentMd: '', error, messageCount };
  }

  try {
    const chunks = chunkMessages(rows, config.summary.maxMessagesPerChunk, config.summary.maxCharsPerChunk);
    let contentMd: string;

    if (chunks.length <= 1) {
      const prompt = buildSummaryPrompt({
        groupName: group.name,
        start: opts.start,
        end: opts.end,
        messages: toPromptMessages(rows),
        totalMessages: messageCount,
      });
      contentMd = await runSummaryQuery(prompt, model, opts.onProgress);
    } else {
      // map 阶段：逐段摘要
      const partials: string[] = [];
      for (let i = 0; i < chunks.length; i += 1) {
        opts.onProgress?.(`\n\n> 正在处理第 ${i + 1}/${chunks.length} 段…\n\n`);
        const prompt = buildPartialPrompt({
          groupName: group.name,
          index: i,
          total: chunks.length,
          messages: toPromptMessages(chunks[i]),
        });
        partials.push(await runSummaryQuery(prompt, model));
      }
      // reduce 阶段：汇总
      const reducePrompt = buildReducePrompt({
        groupName: group.name,
        start: opts.start,
        end: opts.end,
        partials,
        totalMessages: messageCount,
      });
      contentMd = await runSummaryQuery(reducePrompt, model, opts.onProgress);
    }

    db.updateSummary(summaryId, { content_md: contentMd, status: 'done' });
    return { summaryId, status: 'done', contentMd, messageCount };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[summary] 生成失败:', error);
    db.updateSummary(summaryId, { status: 'failed', error });
    return { summaryId, status: 'failed', contentMd: '', error, messageCount };
  }
}

/** 计算默认时间窗（最近 N 分钟） */
export function defaultWindow(windowMinutes?: number): { start: string; end: string } {
  const minutes = windowMinutes && windowMinutes > 0 ? windowMinutes : config.summary.defaultWindowMinutes;
  const end = new Date();
  const start = new Date(end.getTime() - minutes * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}
