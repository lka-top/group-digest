/**
 * 类型定义
 */

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

export interface Model {
  modelId: string;
  name: string;
  description?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input?: Record<string, unknown>;
  status: 'running' | 'completed' | 'error';
  result?: string;
  isError?: boolean;
}

/**
 * 内容块类型 - 支持文字和工具调用按顺序排列
 */
export type ContentBlock = 
  | { type: 'text'; text: string }
  | { type: 'tool_use'; toolCall: ToolCall };

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;  // 保留用于兼容，存储纯文本摘要
  model?: string;
  timestamp: Date;
  isStreaming?: boolean;
  toolCalls?: ToolCall[];  // 保留用于兼容
  contentBlocks?: ContentBlock[];  // 新增：按顺序排列的内容块
}

export interface Session {
  id: string;
  title: string;
  model: string;
  agentId?: string;
  cwd?: string;
  permissionMode?: PermissionMode;
  createdAt: Date;
  messages: Message[];
}

export interface CustomAgent {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  icon?: string;
  color?: string;
  permissionMode?: PermissionMode;
  createdAt: Date;
  updatedAt: Date;
}

// Agent 是 CustomAgent 的别名
export type Agent = CustomAgent;

export type Theme = 'light' | 'dark';

/**
 * 权限请求 - 用于工具调用确认
 */
export interface PermissionRequest {
  requestId: string;
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  sessionId: string;
  timestamp: number;
}

/**
 * 权限响应
 */
export interface PermissionResponse {
  requestId: string;
  behavior: 'allow' | 'deny';
  message?: string;
}

// ############################################################################
// # 群聊总结域类型
// ############################################################################

export interface Group {
  id: string;
  platform_account_id: string;
  platform_group_id: string;
  name: string;
  member_count: number;
  max_member_count: number;
  avatar: string | null;
  platform: string;
  account_self_id: string | null;
  account_display_name: string | null;
  account_status: string;
  /** 是否读取该群（1 启用 / 0 过滤） */
  enabled: number;
  /** 最近一次开始授权监控的时间 */
  authorized_at: string | null;
  /** 群优先级，数值越大越优先 */
  priority: number;
  summary_enabled: number;
  push_enabled: number;
  mode_source: 'root' | 'platform' | 'account' | 'group';
  priority_source: 'root' | 'platform' | 'account' | 'group';
  default_schedule_id: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export type GroupProcessingMode = 'off' | 'record' | 'summary' | 'push';

export interface GroupMessage {
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
  group_name: string;
  platform_group_id: string;
  platform: string;
  account_self_id: string | null;
  account_display_name: string | null;
}

export interface Summary {
  id: string;
  group_id: string;
  group_name?: string | null;
  platform_group_id?: string | null;
  platform?: string | null;
  account_self_id?: string | null;
  account_display_name?: string | null;
  schedule_id: string | null;
  trigger_type: 'manual' | 'schedule' | 'instant' | string;
  window_start: string;
  window_end: string;
  content_md: string;
  model: string | null;
  token_usage: number | null;
  status: 'generating' | 'done' | 'failed' | string;
  error: string | null;
  created_at: string;
}

export interface PriorityRule {
  id: string;
  name: string;
  scope_type: 'global' | 'group' | string;
  group_id: string | null;
  match_type: 'keyword' | 'sender' | 'regex' | string;
  pattern: string;
  priority: number;
  action: 'instant_notify' | 'boost_summary' | string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface Schedule {
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

export interface AppNotification {
  id: string;
  type: 'summary' | 'instant' | 'system' | string;
  title: string;
  body: string;
  group_id: string | null;
  summary_id: string | null;
  priority: number;
  read: number;
  channels: string | null;
  created_at: string;
}

export interface DashboardStats {
  platforms: number;
  accounts: number;
  connectedAccounts: number;
  groups: number;
  enabledGroups: number;
  messages: number;
  messages24h: number;
  summaries: number;
  unreadNotifications: number;
}

export interface DashboardData {
  stats: DashboardStats;
  adapter: {
    kind: string;
    platform: string;
    status: string;
    selfId: string;
    accounts: Array<{ selfId: string; displayName?: string; status: string }>;
  };
  aiConfigured: boolean;
  aiProvider: string;
  sseClients: number;
  timezone: string;
}

/** 全局 SSE 事件 */
export type AppEventPayload =
  | {
      type: 'message';
      groupId: string;
      message: {
        id: string;
        groupId: string;
        groupName?: string;
        senderId: string;
        senderName: string;
        content: string;
        timestamp: string;
      };
    }
  | { type: 'summary'; groupId: string; summaryId: string; title: string; status: string }
  | { type: 'instant'; groupId: string | null; notificationId: string; title: string; priority: number }
  | { type: 'status'; adapter: string; status: string; info?: string }
  | { type: 'groups_synced'; adapter: string; count: number }
  | { type: 'group_config'; count: number }
  | { type: 'hello'; ts: number };
