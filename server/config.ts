/**
 * 应用集中配置
 * 统一从环境变量（.env）读取，带合理兜底值。
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type AdapterKind = 'onebot11' | (string & {});
export type OneBotMode = 'reverse-ws' | 'forward-ws' | 'http';
export type SummaryProviderKind = 'codebuddy' | 'openai-compatible' | 'ollama';

function envStr(key: string, def: string): string {
  const v = process.env[key];
  return v === undefined || v === '' ? def : v;
}

function envInt(key: string, def: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function envBool(key: string, def: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export const config = {
  /** HTTP API 端口 */
  port: envInt('PORT', 3000),

  /** 当前启用的平台适配器；公开版本默认使用 OneBot 11。 */
  adapter: envStr('ADAPTER', 'onebot11') as AdapterKind,

  /** OneBot 11 接入配置（ADAPTER=onebot11 时生效） */
  onebot: {
    /** 连接模式：反向 WS 服务端（NapCat 连入）/ 正向 WS 客户端 / HTTP */
    mode: envStr('ONEBOT_MODE', 'reverse-ws') as OneBotMode,
    /** 反向 WS 服务端监听端口 */
    wsPort: envInt('ONEBOT_WS_PORT', 3001),
    /** 反向 WS 路径 */
    wsPath: envStr('ONEBOT_WS_PATH', '/onebot/v11/ws'),
    /** 鉴权密钥（NapCat 网络配置中的 access token） */
    token: envStr('ONEBOT_TOKEN', ''),
    /** 正向 WS 客户端要连接的 NapCat WS 地址，如 ws://127.0.0.1:3001 */
    napcatWsUrl: envStr('ONEBOT_NAPCAT_WS_URL', ''),
    /** HTTP API 基地址，如 http://127.0.0.1:3000 */
    httpBaseUrl: envStr('ONEBOT_HTTP_BASE_URL', ''),
  },

  /** AI 总结引擎 */
  summary: {
    provider: envStr('AI_PROVIDER', 'codebuddy') as SummaryProviderKind,
    baseUrl: envStr('AI_BASE_URL', ''),
    apiKey: envStr('AI_API_KEY', ''),
    model: envStr('SUMMARY_MODEL', 'balanced-model'),
    /** 单个分片包含的最大消息条数 */
    maxMessagesPerChunk: envInt('SUMMARY_CHUNK_MESSAGES', 30),
    /** 单个分片的最大字符数 */
    maxCharsPerChunk: envInt('SUMMARY_CHUNK_CHARS', 6000),
    /** 默认总结时间窗（分钟） */
    defaultWindowMinutes: envInt('SUMMARY_WINDOW_MINUTES', 720),
  },

  /** 通知与即时提醒节流 */
  notify: {
    /** 同一 (群, 规则) 的即时提醒冷却时间（毫秒） */
    instantCooldownMs: envInt('INSTANT_COOLDOWN_MS', 5 * 60 * 1000),
    /** 全局限流：每分钟最多即时提醒条数 */
    instantPerMinute: envInt('INSTANT_PER_MINUTE', 10),
  },

  /** 邮件推送（SMTP），后续阶段启用 */
  smtp: {
    host: envStr('SMTP_HOST', ''),
    port: envInt('SMTP_PORT', 465),
    secure: envBool('SMTP_SECURE', true),
    user: envStr('SMTP_USER', ''),
    pass: envStr('SMTP_PASS', ''),
    from: envStr('SMTP_FROM', ''),
  },

  /** 默认时区 */
  timezone: envStr('TZ', 'Asia/Shanghai'),

  /** 数据目录 */
  dataDir: path.join(__dirname, '..', 'data'),

  /** 应用版本 */
  version: '1.0.0',
};

export default config;
