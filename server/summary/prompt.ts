/**
 * 总结提示词模板与消息分片
 */
import type { DbGroupMessage } from '../db.js';

export const SUMMARY_SYSTEM_PROMPT = `你是一名专业的群聊内容分析助手。
你的任务是把一段时间内的群聊记录，整理成一份结构清晰、重点突出的中文总结。

要求：
1. 只依据提供的聊天记录，不要编造未出现的信息；无法判断的内容可注明"信息不足"。
2. 语言精炼，使用 Markdown 格式，便于直接阅读。
3. 关注：讨论的主要话题、达成的结论/决定、待办事项与责任人、需要关注的问题（报错、故障、投诉、风险）。
4. 忽略无意义的寒暄与灌水内容，但对关键发言可做要点摘录。
5. 如出现 @某人 的重要诉求，请明确指出。`;

export interface PromptMessage {
  senderName: string;
  time: string;
  content: string;
}

function formatLine(m: PromptMessage): string {
  return `[${m.time}] ${m.senderName}: ${m.content}`;
}

/** 生成单次总结的用户提示词 */
export function buildSummaryPrompt(params: {
  groupName: string;
  start: string;
  end: string;
  messages: PromptMessage[];
  totalMessages: number;
}): string {
  const { groupName, start, end, messages, totalMessages } = params;
  const body = messages.map(formatLine).join('\n');
  return `请为群聊「${groupName}」生成一份总结。

【时间范围】${formatRange(start)} ~ ${formatRange(end)}
【消息条数】${totalMessages}
【聊天记录】
${body}

请严格按以下结构输出 Markdown：
# ${groupName} 群聊总结
> 时间范围：${formatRange(start)} ~ ${formatRange(end)}

## 群概况
（2-3 句概述这段时间群内的整体情况与讨论热度）

## 热点话题
（分点列出讨论的主要话题，每个话题说明核心内容与主要参与者）

## 结论与决定
（如有明确结论或决定，分点列出；没有则写"暂无"）

## 待办事项
（列出需要跟进的待办，尽量标注责任人；没有则写"暂无"）

## 需要关注
（报错、故障、投诉、风险、@某人的重要诉求等；没有则写"暂无"）

## 关键消息摘录
（摘录 3-8 条最有价值的关键发言，格式：\`发言人\`：内容）`;
}

/** 生成「分段摘要」的用户提示词（map 阶段） */
export function buildPartialPrompt(params: {
  groupName: string;
  index: number;
  total: number;
  messages: PromptMessage[];
}): string {
  const body = params.messages.map(formatLine).join('\n');
  return `这是群聊「${params.groupName}」的第 ${params.index + 1}/${params.total} 段聊天记录（按时间顺序）。
请提炼本段的要点，输出简洁的 Markdown 分点列表，覆盖：主要话题、结论/决定、待办与责任人、需要关注的问题。不要写客套话。

${body}`;
}

/** 生成「汇总摘要」的用户提示词（reduce 阶段） */
export function buildReducePrompt(params: {
  groupName: string;
  start: string;
  end: string;
  partials: string[];
  totalMessages: number;
}): string {
  const body = params.partials.map((p, i) => `--- 第 ${i + 1} 段要点 ---\n${p}`).join('\n\n');
  return `下面是群聊「${params.groupName}」在 ${formatRange(params.start)} ~ ${formatRange(params.end)} 期间的分段要点（共 ${params.totalMessages} 条消息）。
请把它们合并去重，输出一份完整的 Markdown 总结，结构固定为：

# ${params.groupName} 群聊总结
> 时间范围：${formatRange(params.start)} ~ ${formatRange(params.end)}

## 群概况
## 热点话题
## 结论与决定
## 待办事项
## 需要关注
## 关键消息摘录

各段落若无内容则写"暂无"。

【分段要点】
${body}`;
}

/** 把数据库消息转成提示词消息 */
export function toPromptMessages(rows: DbGroupMessage[]): PromptMessage[] {
  return rows.map((r) => ({
    senderName: r.sender_card || r.sender_name || r.sender_id || '未知',
    time: formatTime(r.timestamp),
    content: r.content,
  }));
}

/**
 * 按「条数」与「字符数」双阈值把消息切成多片，避免超出上下文。
 */
export function chunkMessages(
  rows: DbGroupMessage[],
  maxMessages: number,
  maxChars: number
): DbGroupMessage[][] {
  const chunks: DbGroupMessage[][] = [];
  let current: DbGroupMessage[] = [];
  let chars = 0;

  for (const row of rows) {
    const len = (row.content?.length || 0) + 40; // 加上发言人/时间前缀的粗略开销
    if (current.length > 0 && (current.length >= maxMessages || chars + len > maxChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(row);
    chars += len;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function formatRange(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
