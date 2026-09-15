/**
 * 全局设置路由（AI / 适配器 / OneBot / SMTP）
 */
import { Router } from 'express';
import * as db from '../db.js';
import config from '../config.js';
import { getAdapter } from '../adapters/index.js';
import { resetEmailTransport, verifyEmail } from '../notify/email.js';
import {
  getSummaryAiSettings,
  getSummaryProviderStatus,
  isSummaryProvider,
  runSummaryQuery,
  type SummaryAiSettings,
} from '../summary/provider.js';

export const settingsRouter = Router();

function mask(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

/** 读取设置（敏感字段脱敏） */
settingsRouter.get('/', (_req, res) => {
  const saved = db.getAllSettings();
  const adapter = getAdapter();
  const adapterAccounts = adapter.getAccounts();
  const onebot = (saved.onebot as Record<string, unknown>) || {};
  const smtp = (saved.smtp as Record<string, unknown>) || {};
  const ai = getSummaryAiSettings();
  const aiStatus = getSummaryProviderStatus();

  res.json({
    runtime: {
      adapter: config.adapter,
      adapterStatus: adapter.getStatus(),
      adapterAccounts,
      port: config.port,
      timezone: config.timezone,
      aiConfigured: aiStatus.configured,
      aiProvider: aiStatus.provider,
    },
    ai: {
      provider: ai.provider,
      baseUrl: ai.baseUrl,
      model: ai.model,
      apiKeySet: Boolean(ai.apiKey),
      apiKey: mask(ai.apiKey),
    },
    onebot: {
      mode: (onebot.mode as string) || config.onebot.mode,
      wsPort: (onebot.wsPort as number) || config.onebot.wsPort,
      wsPath: (onebot.wsPath as string) || config.onebot.wsPath,
      napcatWsUrl: (onebot.napcatWsUrl as string) || config.onebot.napcatWsUrl,
      httpBaseUrl: (onebot.httpBaseUrl as string) || config.onebot.httpBaseUrl,
      tokenSet: Boolean((onebot.token as string) || config.onebot.token),
      token: mask((onebot.token as string) || config.onebot.token),
    },
    smtp: {
      host: (smtp.host as string) || config.smtp.host,
      port: (smtp.port as number) || config.smtp.port,
      secure: (smtp.secure as boolean) ?? config.smtp.secure,
      user: (smtp.user as string) || config.smtp.user,
      passSet: Boolean((smtp.pass as string) || config.smtp.pass),
      pass: mask((smtp.pass as string) || config.smtp.pass),
      from: (smtp.from as string) || config.smtp.from,
    },
  });
});

/** 保存设置 */
settingsRouter.post('/', (req, res) => {
  const { adapter, ai, onebot, smtp } = req.body ?? {};
  if (adapter !== undefined) {
    if (adapter !== 'onebot11') {
      return res.status(400).json({ error: '公开版本当前仅支持 onebot11 适配器' });
    }
    db.setSetting('adapter', adapter);
  }
  if (ai !== undefined) {
    if (!ai || typeof ai !== 'object' || !isSummaryProvider(ai.provider)) {
      return res.status(400).json({ error: 'AI 提供方配置无效' });
    }
    if (typeof ai.model !== 'string' || !ai.model.trim()) {
      return res.status(400).json({ error: 'AI 模型名不能为空' });
    }
    if (ai.provider !== 'codebuddy' && (typeof ai.baseUrl !== 'string' || !/^https?:\/\//i.test(ai.baseUrl))) {
      return res.status(400).json({ error: 'AI 接口地址必须以 http:// 或 https:// 开头' });
    }
    const previous = db.getSetting<Record<string, unknown>>('ai') || {};
    db.setSetting('ai', { ...previous, ...ai, model: ai.model.trim(), baseUrl: String(ai.baseUrl || '').trim() });
  }
  if (onebot && typeof onebot === 'object') {
    if (onebot.mode !== 'reverse-ws') {
      return res.status(400).json({ error: '当前版本仅支持 OneBot 反向 WebSocket 模式' });
    }
    const port = Number(onebot.wsPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return res.status(400).json({ error: 'OneBot WS 端口必须是 1~65535 的整数' });
    }
    if (typeof onebot.wsPath !== 'string' || !onebot.wsPath.startsWith('/')) {
      return res.status(400).json({ error: 'OneBot WS 路径必须以 / 开头' });
    }
    const previous = db.getSetting<Record<string, unknown>>('onebot') || {};
    db.setSetting('onebot', { ...previous, ...onebot });
  }
  if (smtp) {
    if (typeof smtp !== 'object') return res.status(400).json({ error: 'smtp 配置格式无效' });
    const previous = db.getSetting<Record<string, unknown>>('smtp') || {};
    db.setSetting('smtp', { ...previous, ...smtp });
    resetEmailTransport();
  }
  res.json({
    ok: true,
    note: '已保存；AI 配置立即生效，消息源与 OneBot 配置需重启服务',
  });
});

/** 主动测试当前（或表单中尚未保存的）AI 配置。 */
settingsRouter.post('/test-ai', async (req, res) => {
  try {
    const input = (req.body || {}) as Partial<SummaryAiSettings>;
    const current = getSummaryAiSettings();
    const override: Partial<SummaryAiSettings> = {
      ...input,
      apiKey: typeof input.apiKey === 'string' && input.apiKey ? input.apiKey : current.apiKey,
    };
    const text = await runSummaryQuery('这是一次连通性测试。请只回复：连接成功', override.model, undefined, override);
    res.json({ ok: true, detail: text.slice(0, 120) });
  } catch (err) {
    res.status(400).json({ ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
});

/** 测试 SMTP 连通性 */
settingsRouter.post('/test-email', async (req, res) => {
  const saved = db.getSetting<Record<string, unknown>>('smtp') || {};
  const runtime = (req.body && Object.keys(req.body).length ? req.body : saved) as Record<string, unknown>;
  const result = await verifyEmail(runtime as never);
  res.json(result);
});
