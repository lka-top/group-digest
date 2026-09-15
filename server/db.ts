import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库文件路径
const dbPath = path.join(__dirname, '..', 'data', 'chat.db');

// 确保 data 目录存在
import fs from 'fs';
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 创建数据库连接
const db = new Database(dbPath);

// 启用 WAL 模式以提高性能
db.pragma('journal_mode = WAL');
// SQLite 默认不启用外键约束；显式开启以保证级联删除与引用完整性。
db.pragma('foreign_keys = ON');

// 初始化数据库表
db.exec(`
  -- 会话表
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    sdk_session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 消息表
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    model TEXT,
    created_at TEXT NOT NULL,
    tool_calls TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  -- 为会话 ID 创建索引
  CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
`);

// 数据库迁移：添加 sdk_session_id 列（如果不存在）
try {
  const tableInfo = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  const hasColumn = tableInfo.some(col => col.name === 'sdk_session_id');
  if (!hasColumn) {
    db.exec("ALTER TABLE sessions ADD COLUMN sdk_session_id TEXT");
    console.log("[DB] Added sdk_session_id column to sessions table");
  }
} catch (e) {
  // 忽略错误（列可能已存在）
}

// 类型定义
export interface DbSession {
  id: string;
  title: string;
  model: string;
  sdk_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  created_at: string;
  tool_calls: string | null;
}

// ============= 会话操作 =============

// 获取所有会话
export function getAllSessions(): DbSession[] {
  const stmt = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC');
  return stmt.all() as DbSession[];
}

// 获取单个会话
export function getSession(id: string): DbSession | undefined {
  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
  return stmt.get(id) as DbSession | undefined;
}

// 创建会话
export function createSession(session: DbSession): DbSession {
  const stmt = db.prepare(`
    INSERT INTO sessions (id, title, model, sdk_session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(session.id, session.title, session.model, session.sdk_session_id, session.created_at, session.updated_at);
  return session;
}

// 更新会话
export function updateSession(id: string, updates: Partial<Pick<DbSession, 'title' | 'model' | 'sdk_session_id'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.model !== undefined) {
    fields.push('model = ?');
    values.push(updates.model);
  }
  if (updates.sdk_session_id !== undefined) {
    fields.push('sdk_session_id = ?');
    values.push(updates.sdk_session_id);
  }
  
  if (fields.length === 0) return false;
  
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  
  const stmt = db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

// 删除会话
export function deleteSession(id: string): boolean {
  const stmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// ============= 消息操作 =============

// 获取会话的所有消息
export function getMessagesBySession(sessionId: string): DbMessage[] {
  const stmt = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC');
  return stmt.all(sessionId) as DbMessage[];
}

// 创建消息
export function createMessage(message: DbMessage): DbMessage {
  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    message.id,
    message.session_id,
    message.role,
    message.content,
    message.model,
    message.created_at,
    message.tool_calls
  );
  
  // 更新会话的 updated_at
  const updateStmt = db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?');
  updateStmt.run(new Date().toISOString(), message.session_id);
  
  return message;
}

// 更新消息内容
export function updateMessage(id: string, updates: Partial<Pick<DbMessage, 'content' | 'tool_calls'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(updates.content);
  }
  if (updates.tool_calls !== undefined) {
    fields.push('tool_calls = ?');
    values.push(updates.tool_calls);
  }
  
  if (fields.length === 0) return false;
  
  values.push(id);
  
  const stmt = db.prepare(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

// 删除消息
export function deleteMessage(id: string): boolean {
  const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// 批量创建消息（用于保存对话）
export function createMessages(messages: DbMessage[]): void {
  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((msgs: DbMessage[]) => {
    for (const msg of msgs) {
      stmt.run(msg.id, msg.session_id, msg.role, msg.content, msg.model, msg.created_at, msg.tool_calls);
    }
  });
  
  insertMany(messages);
}

// 清空所有数据
export function clearAllData(): void {
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM sessions');
}

// ############################################################################
// # 群聊域（消息接入 + AI 总结）
// # 说明：以下表与模板自带的 sessions/messages 完全独立，互不建外键。
// ############################################################################

db.exec(`
  -- 全局设置（键值对，存适配器 / SMTP 等）
  CREATE TABLE IF NOT EXISTS global_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 平台账号（一个 QQ 号 / OneBot 实例 = 一条）
  CREATE TABLE IF NOT EXISTS platform_accounts (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    self_id TEXT,
    display_name TEXT,
    status TEXT NOT NULL DEFAULT 'offline',
    last_connected_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 群
  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    platform_account_id TEXT NOT NULL,
    platform_group_id TEXT NOT NULL,
    name TEXT NOT NULL,
    member_count INTEGER NOT NULL DEFAULT 0,
    max_member_count INTEGER NOT NULL DEFAULT 0,
    avatar TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(platform_account_id, platform_group_id),
    FOREIGN KEY (platform_account_id) REFERENCES platform_accounts(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_groups_account ON groups(platform_account_id);

  -- 群配置（过滤 + 优先级）
  CREATE TABLE IF NOT EXISTS group_configs (
    group_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    authorized_at TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    summary_enabled INTEGER NOT NULL DEFAULT 1,
    push_enabled INTEGER NOT NULL DEFAULT 1,
    mode_source TEXT NOT NULL DEFAULT 'group',
    priority_source TEXT NOT NULL DEFAULT 'group',
    default_schedule_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );

  -- 非叶子节点默认策略；字段允许为空，以便账号未覆盖的部分继续继承平台/根节点。
  CREATE TABLE IF NOT EXISTS source_policies (
    scope_type TEXT NOT NULL CHECK (scope_type IN ('root', 'platform', 'account')),
    scope_key TEXT NOT NULL,
    processing_mode TEXT CHECK (processing_mode IN ('off', 'record', 'summary', 'push')),
    priority INTEGER CHECK (priority BETWEEN 0 AND 999),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope_type, scope_key)
  );

  -- 群原始消息（命名 group_messages，避开模板 messages）
  CREATE TABLE IF NOT EXISTS group_messages (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    platform_message_id TEXT NOT NULL,
    sender_id TEXT,
    sender_name TEXT,
    sender_card TEXT,
    sender_role TEXT,
    content TEXT NOT NULL,
    raw_content TEXT NOT NULL,
    cq_parsed INTEGER NOT NULL DEFAULT 0,
    message_type TEXT NOT NULL DEFAULT 'group',
    sub_type TEXT,
    seq INTEGER,
    ingest_source TEXT NOT NULL DEFAULT 'live',
    timestamp TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(group_id, platform_message_id),
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_gm_group_time ON group_messages(group_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_gm_group_seq ON group_messages(group_id, seq);

  -- AI 总结
  CREATE TABLE IF NOT EXISTS summaries (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    schedule_id TEXT,
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    window_start TEXT NOT NULL,
    window_end TEXT NOT NULL,
    content_md TEXT NOT NULL DEFAULT '',
    model TEXT,
    token_usage INTEGER,
    status TEXT NOT NULL DEFAULT 'generating',
    error TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sum_group_time ON summaries(group_id, created_at);

  -- 优先级规则
  CREATE TABLE IF NOT EXISTS priority_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    scope_type TEXT NOT NULL DEFAULT 'global',
    group_id TEXT,
    match_type TEXT NOT NULL DEFAULT 'keyword',
    pattern TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    action TEXT NOT NULL DEFAULT 'instant_notify',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 定时总结计划
  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    group_id TEXT,
    cron TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    window_minutes INTEGER NOT NULL DEFAULT 720,
    channels TEXT NOT NULL DEFAULT '["console"]',
    email_to TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run TEXT,
    next_run TEXT,
    last_status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 通知
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    group_id TEXT,
    summary_id TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    read INTEGER NOT NULL DEFAULT 0,
    channels TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notif_read_time ON notifications(read, created_at);

  -- 推送日志
  CREATE TABLE IF NOT EXISTS push_logs (
    id TEXT PRIMARY KEY,
    notification_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    sent_at TEXT NOT NULL,
    FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
  );
`);

// 群聊域增量迁移：为既有数据库补充授权边界与消息来源。
try {
  const configColumns = db.prepare('PRAGMA table_info(group_configs)').all() as Array<{ name: string }>;
  if (!configColumns.some((column) => column.name === 'authorized_at')) {
    db.exec('ALTER TABLE group_configs ADD COLUMN authorized_at TEXT');
  }
  if (!configColumns.some((column) => column.name === 'mode_source')) {
    db.exec("ALTER TABLE group_configs ADD COLUMN mode_source TEXT NOT NULL DEFAULT 'group'");
  }
  if (!configColumns.some((column) => column.name === 'priority_source')) {
    db.exec("ALTER TABLE group_configs ADD COLUMN priority_source TEXT NOT NULL DEFAULT 'group'");
  }
  // 旧版本中已经开启的群，以最后一次配置更新时间作为最接近的授权起点。
  db.exec(`UPDATE group_configs SET authorized_at = updated_at WHERE enabled = 1 AND authorized_at IS NULL`);
  // 三个处理阶段是严格依赖链：读取 → 总结 → 推送。清理旧版本可能存在的无效组合。
  db.exec(`UPDATE group_configs SET summary_enabled = 0, push_enabled = 0 WHERE enabled = 0`);
  db.exec(`UPDATE group_configs SET push_enabled = 0 WHERE summary_enabled = 0`);

  const messageColumns = db.prepare('PRAGMA table_info(group_messages)').all() as Array<{ name: string }>;
  if (!messageColumns.some((column) => column.name === 'ingest_source')) {
    db.exec("ALTER TABLE group_messages ADD COLUMN ingest_source TEXT NOT NULL DEFAULT 'live'");
    // 旧版本只有用户主动回填才可能保存授权时间之前的消息，迁移时恢复其来源语义。
    db.exec(`
      UPDATE group_messages
      SET ingest_source = 'backfill'
      WHERE EXISTS (
        SELECT 1 FROM group_configs c
        WHERE c.group_id = group_messages.group_id
          AND c.authorized_at IS NOT NULL
          AND group_messages.timestamp < c.authorized_at
      )
    `);
  }
} catch (error) {
  console.error('[DB] 群授权字段迁移失败:', error);
}

// ============= 类型定义（群聊域） =============

export interface DbPlatformAccount {
  id: string;
  platform: string;
  self_id: string | null;
  display_name: string | null;
  status: string;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbGroup {
  id: string;
  platform_account_id: string;
  platform_group_id: string;
  name: string;
  member_count: number;
  max_member_count: number;
  avatar: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbGroupConfig {
  group_id: string;
  enabled: number;
  authorized_at: string | null;
  priority: number;
  summary_enabled: number;
  push_enabled: number;
  mode_source: 'root' | 'platform' | 'account' | 'group';
  priority_source: 'root' | 'platform' | 'account' | 'group';
  default_schedule_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbSourcePolicy {
  scope_type: 'root' | 'platform' | 'account';
  scope_key: string;
  processing_mode: GroupProcessingMode | null;
  priority: number | null;
  created_at: string;
  updated_at: string;
}

export interface GroupWithConfig extends DbGroup {
  platform: string;
  account_self_id: string | null;
  account_display_name: string | null;
  account_status: string;
  enabled: number;
  authorized_at: string | null;
  priority: number;
  summary_enabled: number;
  push_enabled: number;
  mode_source: 'root' | 'platform' | 'account' | 'group';
  priority_source: 'root' | 'platform' | 'account' | 'group';
  default_schedule_id: string | null;
  message_count: number;
}

export interface DbGroupMessage {
  id: string;
  group_id: string;
  platform_message_id: string;
  sender_id: string | null;
  sender_name: string | null;
  sender_card: string | null;
  sender_role: string | null;
  content: string;
  raw_content: string;
  cq_parsed: number;
  message_type: string;
  sub_type: string | null;
  seq: number | null;
  ingest_source: 'live' | 'backfill' | string;
  timestamp: string;
  created_at: string;
}

export interface GroupMessageWithContext extends DbGroupMessage {
  group_name: string;
  platform_group_id: string;
  platform: string;
  account_self_id: string | null;
  account_display_name: string | null;
}

export interface DbSummary {
  id: string;
  group_id: string;
  schedule_id: string | null;
  trigger_type: string;
  window_start: string;
  window_end: string;
  content_md: string;
  model: string | null;
  token_usage: number | null;
  status: string;
  error: string | null;
  created_at: string;
}

export interface DbPriorityRule {
  id: string;
  name: string;
  scope_type: string;
  group_id: string | null;
  match_type: string;
  pattern: string;
  priority: number;
  action: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface DbSchedule {
  id: string;
  name: string;
  group_id: string | null;
  cron: string;
  timezone: string;
  window_minutes: number;
  channels: string;
  email_to: string | null;
  enabled: number;
  last_run: string | null;
  next_run: string | null;
  last_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  group_id: string | null;
  summary_id: string | null;
  priority: number;
  read: number;
  channels: string | null;
  created_at: string;
}

export interface DbPushLog {
  id: string;
  notification_id: string;
  channel: string;
  status: string;
  detail: string | null;
  sent_at: string;
}

// ============= 全局设置 =============

export function getSetting<T = unknown>(key: string): T | undefined {
  const row = db.prepare('SELECT value FROM global_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return undefined;
  }
}

export function setSetting(key: string, value: unknown): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value), now);
}

export function getAllSettings(): Record<string, unknown> {
  const rows = db.prepare('SELECT key, value FROM global_settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out;
}

// ============= 平台账号 =============

export function upsertPlatformAccount(input: {
  id?: string;
  platform: string;
  self_id?: string | null;
  display_name?: string | null;
  status?: string;
}): DbPlatformAccount {
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT * FROM platform_accounts WHERE platform = ? AND (self_id IS ? OR self_id = ?)')
    .get(input.platform, input.self_id ?? null, input.self_id ?? null) as DbPlatformAccount | undefined;

  const account: DbPlatformAccount = {
    id: existing?.id || input.id || `${input.platform}:${input.self_id || 'default'}`,
    platform: input.platform,
    self_id: input.self_id ?? existing?.self_id ?? null,
    display_name: input.display_name ?? existing?.display_name ?? null,
    status: input.status ?? existing?.status ?? 'offline',
    last_connected_at: existing?.last_connected_at ?? null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO platform_accounts (id, platform, self_id, display_name, status, last_connected_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       platform = excluded.platform,
       self_id = excluded.self_id,
       display_name = excluded.display_name,
       status = excluded.status,
       last_connected_at = excluded.last_connected_at,
       updated_at = excluded.updated_at`
  ).run(
    account.id,
    account.platform,
    account.self_id,
    account.display_name,
    account.status,
    account.last_connected_at,
    account.created_at,
    account.updated_at
  );

  return account;
}

export function updatePlatformAccountStatus(id: string, status: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE platform_accounts SET status = ?, updated_at = ?, last_connected_at = CASE WHEN ? = 'connected' THEN ? ELSE last_connected_at END WHERE id = ?`
  ).run(status, now, status, now, id);
}

export function markAllPlatformAccountsOffline(): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE platform_accounts
     SET status = 'offline', updated_at = ?
     WHERE status <> 'offline'`
  ).run(now);
}

export function getAllPlatformAccounts(): DbPlatformAccount[] {
  return db.prepare('SELECT * FROM platform_accounts ORDER BY created_at ASC').all() as DbPlatformAccount[];
}

export function getPlatformAccount(platform: string, selfId: string): DbPlatformAccount | undefined {
  return db
    .prepare('SELECT * FROM platform_accounts WHERE platform = ? AND self_id = ?')
    .get(platform, selfId) as DbPlatformAccount | undefined;
}

// ============= 群 =============

export function upsertGroup(input: {
  platform_account_id: string;
  platform_group_id: string;
  name: string;
  member_count?: number;
  max_member_count?: number;
  avatar?: string | null;
  /** 新群首次发现时是否采集；真实平台应由用户显式选择后再启用。 */
  default_enabled?: boolean;
}): { group: DbGroup; created: boolean } {
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT * FROM groups WHERE platform_account_id = ? AND platform_group_id = ?')
    .get(input.platform_account_id, input.platform_group_id) as DbGroup | undefined;

  if (existing) {
    db.prepare(
      `UPDATE groups SET name = ?, member_count = ?, max_member_count = ?, avatar = ?, updated_at = ? WHERE id = ?`
    ).run(
      input.name,
      input.member_count ?? existing.member_count,
      input.max_member_count ?? existing.max_member_count,
      input.avatar ?? existing.avatar,
      now,
      existing.id
    );
    return {
      group: {
        ...existing,
        name: input.name,
        member_count: input.member_count ?? existing.member_count,
        max_member_count: input.max_member_count ?? existing.max_member_count,
        avatar: input.avatar ?? existing.avatar,
        updated_at: now,
      },
      created: false,
    };
  }

  const group: DbGroup = {
    id: uuidv4(),
    platform_account_id: input.platform_account_id,
    platform_group_id: input.platform_group_id,
    name: input.name,
    member_count: input.member_count ?? 0,
    max_member_count: input.max_member_count ?? 0,
    avatar: input.avatar ?? null,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO groups (id, platform_account_id, platform_group_id, name, member_count, max_member_count, avatar, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    group.id,
    group.platform_account_id,
    group.platform_group_id,
    group.name,
    group.member_count,
    group.max_member_count,
    group.avatar,
    group.created_at,
    group.updated_at
  );
  const fallbackMode: GroupProcessingMode = input.default_enabled === false ? 'off' : 'push';
  const inherited = resolveSourcePolicy(input.platform_account_id, fallbackMode);
  ensureGroupConfig(group.id, {
    ...processingModeConfig(inherited.processingMode),
    priority: inherited.priority,
    mode_source: inherited.modeSource,
    priority_source: inherited.prioritySource,
  });
  return { group, created: true };
}

export function getAllGroupsWithConfig(): GroupWithConfig[] {
  const rows = db
    .prepare(
      `SELECT g.*, a.platform AS platform,
              a.self_id AS account_self_id,
              a.display_name AS account_display_name,
              a.status AS account_status,
              COALESCE(c.enabled, 1) AS enabled,
              c.authorized_at AS authorized_at,
              COALESCE(c.priority, 0) AS priority,
              COALESCE(c.summary_enabled, 1) AS summary_enabled,
              COALESCE(c.push_enabled, 1) AS push_enabled,
              COALESCE(c.mode_source, 'group') AS mode_source,
              COALESCE(c.priority_source, 'group') AS priority_source,
              c.default_schedule_id AS default_schedule_id,
              (SELECT COUNT(*) FROM group_messages m WHERE m.group_id = g.id) AS message_count
       FROM groups g
       JOIN platform_accounts a ON a.id = g.platform_account_id
       LEFT JOIN group_configs c ON c.group_id = g.id
       ORDER BY priority DESC, g.updated_at DESC`
    )
    .all() as GroupWithConfig[];
  return rows;
}

export function getGroupById(id: string): GroupWithConfig | undefined {
  return db
    .prepare(
      `SELECT g.*, a.platform AS platform,
              a.self_id AS account_self_id,
              a.display_name AS account_display_name,
              a.status AS account_status,
              COALESCE(c.enabled, 1) AS enabled,
              c.authorized_at AS authorized_at,
              COALESCE(c.priority, 0) AS priority,
              COALESCE(c.summary_enabled, 1) AS summary_enabled,
              COALESCE(c.push_enabled, 1) AS push_enabled,
              COALESCE(c.mode_source, 'group') AS mode_source,
              COALESCE(c.priority_source, 'group') AS priority_source,
              c.default_schedule_id AS default_schedule_id,
              (SELECT COUNT(*) FROM group_messages m WHERE m.group_id = g.id) AS message_count
       FROM groups g
       JOIN platform_accounts a ON a.id = g.platform_account_id
       LEFT JOIN group_configs c ON c.group_id = g.id
       WHERE g.id = ?`
    )
    .get(id) as GroupWithConfig | undefined;
}

export function getGroupByPlatform(
  platformAccountId: string,
  platformGroupId: string
): DbGroup | undefined {
  return db
    .prepare('SELECT * FROM groups WHERE platform_account_id = ? AND platform_group_id = ?')
    .get(platformAccountId, platformGroupId) as DbGroup | undefined;
}

export function getGroupByName(name: string): DbGroup | undefined {
  return db.prepare('SELECT * FROM groups WHERE name = ? LIMIT 1').get(name) as DbGroup | undefined;
}

// ============= 群配置 =============

export function ensureGroupConfig(
  groupId: string,
  defaults: {
    enabled?: 0 | 1;
    summary_enabled?: 0 | 1;
    push_enabled?: 0 | 1;
    priority?: number;
    mode_source?: DbGroupConfig['mode_source'];
    priority_source?: DbGroupConfig['priority_source'];
  } = {}
): DbGroupConfig {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM group_configs WHERE group_id = ?').get(groupId) as
    | DbGroupConfig
    | undefined;
  if (existing) return existing;
  db.prepare(
    `INSERT INTO group_configs
      (group_id, enabled, authorized_at, priority, summary_enabled, push_enabled, mode_source, priority_source, default_schedule_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  ).run(
    groupId,
    defaults.enabled ?? 1,
    (defaults.enabled ?? 1) === 1 ? now : null,
    defaults.priority ?? 0,
    defaults.summary_enabled ?? 1,
    defaults.push_enabled ?? 1,
    defaults.mode_source ?? 'group',
    defaults.priority_source ?? 'group',
    now,
    now
  );
  return db.prepare('SELECT * FROM group_configs WHERE group_id = ?').get(groupId) as DbGroupConfig;
}

export function getGroupConfig(groupId: string): DbGroupConfig {
  return ensureGroupConfig(groupId);
}

export function updateGroupConfig(
  groupId: string,
  updates: Partial<
    Pick<
      DbGroupConfig,
      | 'enabled'
      | 'authorized_at'
      | 'priority'
      | 'summary_enabled'
      | 'push_enabled'
      | 'mode_source'
      | 'priority_source'
      | 'default_schedule_id'
    >
  >
): boolean {
  ensureGroupConfig(groupId);
  const fields: string[] = [];
  const values: unknown[] = [];
  const map: Record<string, unknown> = {
    enabled: updates.enabled,
    authorized_at: updates.authorized_at,
    priority: updates.priority,
    summary_enabled: updates.summary_enabled,
    push_enabled: updates.push_enabled,
    mode_source: updates.mode_source,
    priority_source: updates.priority_source,
    default_schedule_id: updates.default_schedule_id,
  };
  for (const [col, val] of Object.entries(map)) {
    if (val !== undefined) {
      fields.push(`${col} = ?`);
      values.push(val);
    }
  }
  if (fields.length === 0) return false;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(groupId);
  const result = db.prepare(`UPDATE group_configs SET ${fields.join(', ')} WHERE group_id = ?`).run(...values);
  return result.changes > 0;
}

export type GroupConfigScope =
  | { type: 'all' }
  | { type: 'platform'; platform: string }
  | { type: 'account'; platformAccountId: string };

export type GroupProcessingMode = 'off' | 'record' | 'summary' | 'push';

export function processingModeConfig(mode: GroupProcessingMode): {
  enabled: 0 | 1;
  summary_enabled: 0 | 1;
  push_enabled: 0 | 1;
} {
  switch (mode) {
    case 'off':
      return { enabled: 0, summary_enabled: 0, push_enabled: 0 };
    case 'record':
      return { enabled: 1, summary_enabled: 0, push_enabled: 0 };
    case 'summary':
      return { enabled: 1, summary_enabled: 1, push_enabled: 0 };
    case 'push':
      return { enabled: 1, summary_enabled: 1, push_enabled: 1 };
  }
}

function getSourcePolicy(scopeType: DbSourcePolicy['scope_type'], scopeKey: string): DbSourcePolicy | undefined {
  return db
    .prepare('SELECT * FROM source_policies WHERE scope_type = ? AND scope_key = ?')
    .get(scopeType, scopeKey) as DbSourcePolicy | undefined;
}

/** 新发现的群按账号 > 平台 > 根节点逐字段继承默认策略。 */
export function resolveSourcePolicy(
  platformAccountId: string,
  fallbackMode: GroupProcessingMode = 'off'
): {
  processingMode: GroupProcessingMode;
  priority: number;
  modeSource: DbGroupConfig['mode_source'];
  prioritySource: DbGroupConfig['priority_source'];
} {
  const account = db
    .prepare('SELECT platform FROM platform_accounts WHERE id = ?')
    .get(platformAccountId) as { platform: string } | undefined;
  const accountPolicy = getSourcePolicy('account', platformAccountId);
  const platformPolicy = account ? getSourcePolicy('platform', account.platform) : undefined;
  const rootPolicy = getSourcePolicy('root', 'all');
  const modePolicy = accountPolicy?.processing_mode
    ? { value: accountPolicy.processing_mode, source: 'account' as const }
    : platformPolicy?.processing_mode
      ? { value: platformPolicy.processing_mode, source: 'platform' as const }
      : rootPolicy?.processing_mode
        ? { value: rootPolicy.processing_mode, source: 'root' as const }
        : { value: fallbackMode, source: 'root' as const };
  const priorityPolicy = accountPolicy?.priority !== null && accountPolicy?.priority !== undefined
    ? { value: accountPolicy.priority, source: 'account' as const }
    : platformPolicy?.priority !== null && platformPolicy?.priority !== undefined
      ? { value: platformPolicy.priority, source: 'platform' as const }
      : rootPolicy?.priority !== null && rootPolicy?.priority !== undefined
        ? { value: rootPolicy.priority, source: 'root' as const }
        : { value: 0, source: 'root' as const };
  return {
    processingMode: modePolicy.value,
    priority: priorityPolicy.value,
    modeSource: modePolicy.source,
    prioritySource: priorityPolicy.source,
  };
}

/** 保存父节点默认值；父级批量下发时清除同字段的下级默认覆盖。 */
function saveSourcePolicy(
  scope: GroupConfigScope,
  updates: { processingMode?: GroupProcessingMode; priority?: number }
): void {
  const scopeType: DbSourcePolicy['scope_type'] =
    scope.type === 'all' ? 'root' : scope.type === 'platform' ? 'platform' : 'account';
  const scopeKey =
    scope.type === 'all' ? 'all' : scope.type === 'platform' ? scope.platform : scope.platformAccountId;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO source_policies
      (scope_type, scope_key, processing_mode, priority, created_at, updated_at)
     VALUES (?, ?, NULL, NULL, ?, ?)`
  ).run(scopeType, scopeKey, now, now);

  const fields: string[] = [];
  const values: unknown[] = [];
  if (updates.processingMode !== undefined) {
    fields.push('processing_mode = ?');
    values.push(updates.processingMode);
  }
  if (updates.priority !== undefined) {
    fields.push('priority = ?');
    values.push(updates.priority);
  }
  if (fields.length) {
    fields.push('updated_at = ?');
    values.push(now, scopeType, scopeKey);
    db.prepare(`UPDATE source_policies SET ${fields.join(', ')} WHERE scope_type = ? AND scope_key = ?`).run(...values);
  }

  const clearedColumns = [
    updates.processingMode !== undefined ? 'processing_mode = NULL' : '',
    updates.priority !== undefined ? 'priority = NULL' : '',
  ].filter(Boolean);
  if (clearedColumns.length === 0 || scope.type === 'account') return;
  if (scope.type === 'all') {
    db.prepare(
      `UPDATE source_policies SET ${clearedColumns.join(', ')}, updated_at = ? WHERE scope_type IN ('platform', 'account')`
    ).run(now);
  } else {
    db.prepare(
      `UPDATE source_policies SET ${clearedColumns.join(', ')}, updated_at = ?
       WHERE scope_type = 'account'
         AND scope_key IN (SELECT id FROM platform_accounts WHERE platform = ?)`
    ).run(now, scope.platform);
  }
}

/** 将处理模式和/或优先级批量应用到树节点下的群。 */
export function updateGroupPolicyByScope(
  scope: GroupConfigScope,
  updates: { processingMode?: GroupProcessingMode; priority?: number }
): { matched: number; updated: number } {
  const matchedGroups = getAllGroupsWithConfig().filter((group) => {
    if (scope.type === 'all') return true;
    if (scope.type === 'platform') return group.platform === scope.platform;
    return group.platform_account_id === scope.platformAccountId;
  });
  if (matchedGroups.length === 0) return { matched: 0, updated: 0 };
  const modeConfig = updates.processingMode ? processingModeConfig(updates.processingMode) : undefined;
  const policySource: DbGroupConfig['mode_source'] =
    scope.type === 'all' ? 'root' : scope.type === 'platform' ? 'platform' : 'account';
  const now = new Date().toISOString();
  let updated = 0;

  db.transaction(() => {
    saveSourcePolicy(scope, updates);
    for (const group of matchedGroups) {
      const nextEnabled = modeConfig?.enabled ?? group.enabled;
      const needsAuthorization = nextEnabled === 1 && (group.enabled !== 1 || !group.authorized_at);
      const modeChanged = Boolean(
        modeConfig &&
          (group.enabled !== modeConfig.enabled ||
            group.summary_enabled !== modeConfig.summary_enabled ||
            group.push_enabled !== modeConfig.push_enabled)
      );
      const priorityChanged = updates.priority !== undefined && group.priority !== updates.priority;
      if (!modeChanged && !priorityChanged && !needsAuthorization) continue;

      if (
        updateGroupConfig(group.id, {
          ...modeConfig,
          mode_source: modeConfig ? policySource : undefined,
          authorized_at: needsAuthorization ? now : undefined,
          priority: updates.priority,
          priority_source: updates.priority !== undefined ? policySource : undefined,
        })
      ) {
        updated += 1;
      }
    }
  })();

  return { matched: matchedGroups.length, updated };
}

/** 清除群级自定义效果，重新采用最近的账号/平台/根节点默认策略。 */
export function inheritGroupPolicy(groupId: string): DbGroupConfig | undefined {
  const group = getGroupById(groupId);
  if (!group) return undefined;
  const inherited = resolveSourcePolicy(group.platform_account_id, 'off');
  const modeConfig = processingModeConfig(inherited.processingMode);
  const authorizedAt =
    modeConfig.enabled === 1 && (group.enabled !== 1 || !group.authorized_at)
      ? new Date().toISOString()
      : undefined;
  updateGroupConfig(groupId, {
    ...modeConfig,
    authorized_at: authorizedAt,
    priority: inherited.priority,
    mode_source: inherited.modeSource,
    priority_source: inherited.prioritySource,
  });
  return getGroupConfig(groupId);
}

export function isGroupEnabled(groupId: string): boolean {
  const cfg = db.prepare('SELECT enabled FROM group_configs WHERE group_id = ?').get(groupId) as
    | { enabled: number }
    | undefined;
  // 未配置时默认启用
  return cfg ? cfg.enabled === 1 : true;
}

export function getEnabledGroupIds(): string[] {
  const rows = db
    .prepare(
      `SELECT g.id FROM groups g
       LEFT JOIN group_configs c ON c.group_id = g.id
       WHERE COALESCE(c.enabled, 1) = 1`
    )
    .all() as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export function getSummaryEnabledGroupIds(): string[] {
  const rows = db
    .prepare(
      `SELECT g.id FROM groups g
       LEFT JOIN group_configs c ON c.group_id = g.id
       WHERE COALESCE(c.enabled, 1) = 1 AND COALESCE(c.summary_enabled, 1) = 1
       ORDER BY COALESCE(c.priority, 0) DESC, g.updated_at DESC`
    )
    .all() as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export function getGroupPriority(groupId: string): number {
  const cfg = db.prepare('SELECT priority FROM group_configs WHERE group_id = ?').get(groupId) as
    | { priority: number }
    | undefined;
  return cfg?.priority ?? 0;
}

// ============= 群消息 =============

export function insertGroupMessage(msg: DbGroupMessage): { inserted: boolean; id: string } {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO group_messages
        (id, group_id, platform_message_id, sender_id, sender_name, sender_card, sender_role, content, raw_content, cq_parsed, message_type, sub_type, seq, ingest_source, timestamp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      msg.id,
      msg.group_id,
      msg.platform_message_id,
      msg.sender_id,
      msg.sender_name,
      msg.sender_card,
      msg.sender_role,
      msg.content,
      msg.raw_content,
      msg.cq_parsed,
      msg.message_type,
      msg.sub_type,
      msg.seq,
      msg.ingest_source,
      msg.timestamp,
      msg.created_at
    );
  return { inserted: result.changes > 0, id: msg.id };
}

export interface QueryMessagesOptions {
  platform?: string;
  platformAccountId?: string;
  groupId?: string;
  start?: string;
  end?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
  order?: 'asc' | 'desc';
}

export function queryGroupMessages(opts: QueryMessagesOptions): {
  items: GroupMessageWithContext[];
  total: number;
  page: number;
  pageSize: number;
} {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, opts.pageSize ?? 50));
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.platform) {
    where.push('a.platform = ?');
    params.push(opts.platform);
  }
  if (opts.platformAccountId) {
    where.push('g.platform_account_id = ?');
    params.push(opts.platformAccountId);
  }
  if (opts.groupId) {
    where.push('m.group_id = ?');
    params.push(opts.groupId);
  }
  if (opts.start) {
    where.push('m.timestamp >= ?');
    params.push(opts.start);
  }
  if (opts.end) {
    where.push('m.timestamp <= ?');
    params.push(opts.end);
  }
  if (opts.keyword) {
    where.push('(m.content LIKE ? OR m.sender_name LIKE ?)');
    params.push(`%${opts.keyword}%`, `%${opts.keyword}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = opts.order === 'asc' ? 'ASC' : 'DESC';

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM group_messages m
         JOIN groups g ON g.id = m.group_id
         JOIN platform_accounts a ON a.id = g.platform_account_id
         ${whereSql}`
      )
      .get(...params) as { c: number }
  ).c;

  const items = db
    .prepare(
      `SELECT m.*, g.name AS group_name, g.platform_group_id,
              a.platform, a.self_id AS account_self_id,
              a.display_name AS account_display_name
       FROM group_messages m
       JOIN groups g ON g.id = m.group_id
       JOIN platform_accounts a ON a.id = g.platform_account_id
       ${whereSql}
       ORDER BY m.timestamp ${order}, m.seq ${order} LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize) as GroupMessageWithContext[];

  return { items, total, page, pageSize };
}

export function getGroupMessagesForWindow(
  groupId: string,
  start: string,
  end: string,
  limit = 5000
): DbGroupMessage[] {
  return db
    .prepare(
      `SELECT * FROM group_messages
       WHERE group_id = ? AND timestamp >= ? AND timestamp <= ?
       ORDER BY timestamp ASC, seq ASC LIMIT ?`
    )
    .all(groupId, start, end, limit) as DbGroupMessage[];
}

export function countMessagesSince(groupId: string, since: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM group_messages WHERE group_id = ? AND timestamp >= ?')
    .get(groupId, since) as { c: number };
  return row.c;
}

// ============= 总结 =============

export function createSummary(summary: DbSummary): DbSummary {
  db.prepare(
    `INSERT INTO summaries
      (id, group_id, schedule_id, trigger_type, window_start, window_end, content_md, model, token_usage, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    summary.id,
    summary.group_id,
    summary.schedule_id,
    summary.trigger_type,
    summary.window_start,
    summary.window_end,
    summary.content_md,
    summary.model,
    summary.token_usage,
    summary.status,
    summary.error,
    summary.created_at
  );
  return summary;
}

export function updateSummary(
  id: string,
  updates: Partial<Pick<DbSummary, 'content_md' | 'status' | 'error' | 'token_usage' | 'model'>>
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  const map: Record<string, unknown> = {
    content_md: updates.content_md,
    status: updates.status,
    error: updates.error,
    token_usage: updates.token_usage,
    model: updates.model,
  };
  for (const [col, val] of Object.entries(map)) {
    if (val !== undefined) {
      fields.push(`${col} = ?`);
      values.push(val);
    }
  }
  if (fields.length === 0) return false;
  values.push(id);
  const result = db.prepare(`UPDATE summaries SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export interface SummaryWithGroup extends DbSummary {
  group_name: string | null;
  platform_group_id: string | null;
  platform: string | null;
  account_self_id: string | null;
  account_display_name: string | null;
}

export function getSummaries(opts: { groupId?: string; page?: number; pageSize?: number }): {
  items: SummaryWithGroup[];
  total: number;
} {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 20));
  const where = opts.groupId ? 'WHERE s.group_id = ?' : '';
  const params = opts.groupId ? [opts.groupId] : [];

  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM summaries s ${where}`).get(...params) as { c: number }
  ).c;

  const items = db
    .prepare(
      `SELECT s.*, g.name AS group_name, g.platform_group_id,
              a.platform, a.self_id AS account_self_id,
              a.display_name AS account_display_name
       FROM summaries s
       LEFT JOIN groups g ON g.id = s.group_id
       LEFT JOIN platform_accounts a ON a.id = g.platform_account_id
       ${where}
       ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize) as SummaryWithGroup[];

  return { items, total };
}

export function getSummary(id: string): SummaryWithGroup | undefined {
  return db
    .prepare(
      `SELECT s.*, g.name AS group_name, g.platform_group_id,
              a.platform, a.self_id AS account_self_id,
              a.display_name AS account_display_name
       FROM summaries s
       LEFT JOIN groups g ON g.id = s.group_id
       LEFT JOIN platform_accounts a ON a.id = g.platform_account_id
       WHERE s.id = ?`
    )
    .get(id) as SummaryWithGroup | undefined;
}

// ============= 优先级规则 =============

export function createPriorityRule(rule: DbPriorityRule): DbPriorityRule {
  db.prepare(
    `INSERT INTO priority_rules
      (id, name, scope_type, group_id, match_type, pattern, priority, action, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    rule.id,
    rule.name,
    rule.scope_type,
    rule.group_id,
    rule.match_type,
    rule.pattern,
    rule.priority,
    rule.action,
    rule.enabled,
    rule.created_at,
    rule.updated_at
  );
  return rule;
}

export function updatePriorityRule(
  id: string,
  updates: Partial<Omit<DbPriorityRule, 'id' | 'created_at' | 'updated_at'>>
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const col of ['name', 'scope_type', 'group_id', 'match_type', 'pattern', 'priority', 'action', 'enabled'] as const) {
    const val = updates[col];
    if (val !== undefined) {
      fields.push(`${col} = ?`);
      values.push(val);
    }
  }
  if (fields.length === 0) return false;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  const result = db.prepare(`UPDATE priority_rules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deletePriorityRule(id: string): boolean {
  return db.prepare('DELETE FROM priority_rules WHERE id = ?').run(id).changes > 0;
}

export function getPriorityRules(enabledOnly = false): DbPriorityRule[] {
  const sql = enabledOnly
    ? 'SELECT * FROM priority_rules WHERE enabled = 1 ORDER BY priority DESC'
    : 'SELECT * FROM priority_rules ORDER BY priority DESC, created_at DESC';
  return db.prepare(sql).all() as DbPriorityRule[];
}

export function getPriorityRule(id: string): DbPriorityRule | undefined {
  return db.prepare('SELECT * FROM priority_rules WHERE id = ?').get(id) as DbPriorityRule | undefined;
}

// ============= 定时计划 =============

export function createSchedule(schedule: DbSchedule): DbSchedule {
  db.prepare(
    `INSERT INTO schedules
      (id, name, group_id, cron, timezone, window_minutes, channels, email_to, enabled, last_run, next_run, last_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    schedule.id,
    schedule.name,
    schedule.group_id,
    schedule.cron,
    schedule.timezone,
    schedule.window_minutes,
    schedule.channels,
    schedule.email_to,
    schedule.enabled,
    schedule.last_run,
    schedule.next_run,
    schedule.last_status,
    schedule.created_at,
    schedule.updated_at
  );
  return schedule;
}

export function updateSchedule(
  id: string,
  updates: Partial<Omit<DbSchedule, 'id' | 'created_at' | 'updated_at'>>
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const col of [
    'name',
    'group_id',
    'cron',
    'timezone',
    'window_minutes',
    'channels',
    'email_to',
    'enabled',
    'last_run',
    'next_run',
    'last_status',
  ] as const) {
    const val = updates[col];
    if (val !== undefined) {
      fields.push(`${col} = ?`);
      values.push(val);
    }
  }
  if (fields.length === 0) return false;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  const result = db.prepare(`UPDATE schedules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteSchedule(id: string): boolean {
  return db.prepare('DELETE FROM schedules WHERE id = ?').run(id).changes > 0;
}

export function getSchedules(enabledOnly = false): DbSchedule[] {
  const sql = enabledOnly
    ? 'SELECT * FROM schedules WHERE enabled = 1 ORDER BY created_at ASC'
    : 'SELECT * FROM schedules ORDER BY created_at DESC';
  return db.prepare(sql).all() as DbSchedule[];
}

export function getSchedule(id: string): DbSchedule | undefined {
  return db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as DbSchedule | undefined;
}

// ============= 通知 =============

export function createNotification(n: DbNotification): DbNotification {
  db.prepare(
    `INSERT INTO notifications (id, type, title, body, group_id, summary_id, priority, read, channels, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(n.id, n.type, n.title, n.body, n.group_id, n.summary_id, n.priority, n.read, n.channels, n.created_at);
  return n;
}

export function getNotifications(opts: { unreadOnly?: boolean; limit?: number } = {}): DbNotification[] {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const where = opts.unreadOnly ? 'WHERE read = 0' : '';
  return db
    .prepare(`SELECT * FROM notifications ${where} ORDER BY read ASC, priority DESC, created_at DESC LIMIT ?`)
    .all(limit) as DbNotification[];
}

export function markNotificationRead(id: string): boolean {
  return db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id).changes > 0;
}

export function markAllNotificationsRead(): number {
  return db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run().changes;
}

export function countUnreadNotifications(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE read = 0').get() as { c: number }).c;
}

// ============= 推送日志 =============

export function createPushLog(log: DbPushLog): DbPushLog {
  db.prepare(
    `INSERT INTO push_logs (id, notification_id, channel, status, detail, sent_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(log.id, log.notification_id, log.channel, log.status, log.detail, log.sent_at);
  return log;
}

// ============= 看板统计 =============

export function getDashboardStats(): {
  platforms: number;
  accounts: number;
  groups: number;
  enabledGroups: number;
  messages: number;
  messages24h: number;
  summaries: number;
  unreadNotifications: number;
} {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const platforms = (
    db
      .prepare("SELECT COUNT(DISTINCT platform) AS c FROM platform_accounts WHERE self_id IS NOT NULL AND self_id <> ''")
      .get() as { c: number }
  ).c;
  const accounts = (
    db.prepare("SELECT COUNT(*) AS c FROM platform_accounts WHERE self_id IS NOT NULL AND self_id <> ''").get() as {
      c: number;
    }
  ).c;
  const groups = (db.prepare('SELECT COUNT(*) AS c FROM groups').get() as { c: number }).c;
  const enabledGroups = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM groups g LEFT JOIN group_configs c ON c.group_id = g.id WHERE COALESCE(c.enabled, 1) = 1`
      )
      .get() as { c: number }
  ).c;
  const messages = (db.prepare('SELECT COUNT(*) AS c FROM group_messages').get() as { c: number }).c;
  const messages24h = (
    db.prepare('SELECT COUNT(*) AS c FROM group_messages WHERE timestamp >= ?').get(since) as { c: number }
  ).c;
  const summaries = (db.prepare('SELECT COUNT(*) AS c FROM summaries').get() as { c: number }).c;
  return {
    platforms,
    accounts,
    groups,
    enabledGroups,
    messages,
    messages24h,
    summaries,
    unreadNotifications: countUnreadNotifications(),
  };
}

export default db;
