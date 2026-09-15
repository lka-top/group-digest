/** 可插拔的总结模型提供方。 */
import { query } from '@tencent-ai/agent-sdk';
import * as db from '../db.js';
import config, { type SummaryProviderKind } from '../config.js';
import { SUMMARY_SYSTEM_PROMPT } from './prompt.js';

export interface SummaryAiSettings {
  provider: SummaryProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface SummaryProviderStatus {
  provider: SummaryProviderKind;
  baseUrl: string;
  model: string;
  configured: boolean;
  apiKeySet: boolean;
}

const PROVIDERS = new Set<SummaryProviderKind>(['codebuddy', 'openai-compatible', 'ollama']);

export function isSummaryProvider(value: unknown): value is SummaryProviderKind {
  return typeof value === 'string' && PROVIDERS.has(value as SummaryProviderKind);
}

/** 数据库配置优先，环境变量作为初始默认值。 */
export function getSummaryAiSettings(override?: Partial<SummaryAiSettings>): SummaryAiSettings {
  const saved = db.getSetting<Partial<SummaryAiSettings>>('ai') || {};
  const provider = isSummaryProvider(override?.provider)
    ? override.provider
    : isSummaryProvider(saved.provider)
      ? saved.provider
      : config.summary.provider;
  const defaultBaseUrl = provider === 'ollama' ? 'http://127.0.0.1:11434/v1' : config.summary.baseUrl;
  return {
    provider,
    baseUrl: String(override?.baseUrl ?? saved.baseUrl ?? defaultBaseUrl).trim().replace(/\/$/, ''),
    apiKey: String(override?.apiKey ?? saved.apiKey ?? config.summary.apiKey).trim(),
    model: String(override?.model ?? saved.model ?? config.summary.model).trim(),
  };
}

export function getSummaryProviderStatus(): SummaryProviderStatus {
  const settings = getSummaryAiSettings();
  // CLI 登录状态只能由 SDK 异步确认；CodeBuddy 模式允许直接尝试调用，
  // 未登录时 SDK 会返回明确错误。否则已完成 CLI 登录的用户会被同步状态误拦截。
  const configured = settings.provider === 'codebuddy'
    ? true
    : settings.provider === 'ollama'
      ? Boolean(settings.baseUrl && settings.model)
      : Boolean(settings.baseUrl && settings.apiKey && settings.model);
  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    configured,
    apiKeySet: Boolean(settings.apiKey),
  };
}

function completionsUrl(baseUrl: string): string {
  return /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
}

function extractContent(payload: unknown): string {
  const data = payload as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
  return data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? '';
}

async function runCompatibleQuery(
  prompt: string,
  settings: SummaryAiSettings,
  onProgress?: (chunk: string) => void,
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  const response = await fetch(completionsUrl(settings.baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: settings.model,
      stream: true,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 800);
    throw new Error(`AI 接口请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const content = extractContent(await response.json());
    if (!content) throw new Error('AI 接口没有返回文本内容');
    onProgress?.(content);
    return content.trim();
  }

  if (!response.body) throw new Error('AI 接口返回了空响应');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      const chunk = extractContent(JSON.parse(data));
      if (chunk) {
        full += chunk;
        onProgress?.(chunk);
      }
    } catch {
      // 某些兼容服务会混入非 JSON 心跳帧。
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    lines.forEach(consumeLine);
    if (done) break;
  }
  if (buffer) consumeLine(buffer);
  if (!full) throw new Error('AI 接口没有返回文本内容');
  return full.trim();
}

async function runCodeBuddyQuery(prompt: string, model: string, onProgress?: (chunk: string) => void): Promise<string> {
  const stream = query({
    prompt,
    options: {
      model,
      maxTurns: 1,
      cwd: process.cwd(),
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      allowedTools: [],
      permissionMode: 'default',
      canUseTool: async () => ({ behavior: 'deny', message: '总结任务不允许调用工具' }),
    },
  });
  let full = '';
  let resultDetail = '';
  let fallbackResult = '';
  for await (const msg of stream as unknown as AsyncIterable<Record<string, unknown>>) {
    if (msg.type === 'result') {
      const result = msg as Record<string, unknown>;
      if (result.is_error || result.subtype === 'error') {
        resultDetail = String(result.result || result.error || result.subtype || '未知 SDK 错误');
      } else if (typeof result.result === 'string') {
        fallbackResult = result.result;
      }
      continue;
    }
    if (msg.type !== 'assistant') continue;
    const content = (msg.message as { content?: unknown } | undefined)?.content;
    if (typeof content === 'string') {
      full += content;
      onProgress?.(content);
    } else if (Array.isArray(content)) {
      for (const block of content as Array<Record<string, unknown>>) {
        if (block.type === 'text' && typeof block.text === 'string') {
          full += block.text;
          onProgress?.(block.text);
        }
      }
    }
  }
  if (!full && fallbackResult.trim()) {
    onProgress?.(fallbackResult);
    return fallbackResult.trim();
  }
  if (!full) {
    throw new Error(resultDetail ? `CodeBuddy 调用失败：${resultDetail}` : 'CodeBuddy 没有返回文本内容');
  }
  return full.trim();
}

export async function runSummaryQuery(
  prompt: string,
  model?: string,
  onProgress?: (chunk: string) => void,
  override?: Partial<SummaryAiSettings>,
): Promise<string> {
  const settings = getSummaryAiSettings({ ...override, ...(model ? { model } : {}) });
  return settings.provider === 'codebuddy'
    ? runCodeBuddyQuery(prompt, settings.model, onProgress)
    : runCompatibleQuery(prompt, settings, onProgress);
}
