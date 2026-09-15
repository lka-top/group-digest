/**
 * OneBot 11 平台适配器（QQ）
 *
 * 兼容 NapCat / LLOneBot 等 OneBot 11 实现。
 *
 * 主推模式：反向 WebSocket 服务端 —— 本应用启动一个 WS 服务，
 * NapCat 作为客户端连入 `ws://<host>:<ONEBOT_WS_PORT><ONEBOT_WS_PATH>`，
 * 事件由 NapCat 推送，动作（发送消息 / 拉群列表）通过同一连接下发。
 *
 * 其他模式（正向 WS 客户端 / HTTP API）为后续阶段实现，当前抛出明确错误。
 *
 * ⚠️ 合规提示：使用第三方协议实现接入个人 QQ 号存在账号风控风险，
 *    请使用专用小号，并仅接入你有权管理的群。
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { v4 as uuidv4 } from 'uuid';
import {
  BaseAdapter,
  type GroupHistoryOptions,
  type PlatformAccountConnection,
  type UnifiedGroup,
  type UnifiedMessage,
} from './types.js';
import config from '../config.js';
import { parseCqCode } from '../ingest/cqcode.js';

/** OneBot 11 群消息事件（仅声明用到的字段） */
interface Ob11GroupMessageEvent {
  post_type: 'message' | 'message_sent';
  message_type: 'group' | 'private';
  sub_type?: string;
  message_id: number;
  group_id?: number;
  user_id?: number;
  message: unknown;
  raw_message?: string;
  font?: number;
  self_id: number;
  time: number;
  sender?: {
    user_id?: number;
    nickname?: string;
    card?: string;
    role?: 'owner' | 'admin' | 'member';
  };
  message_seq?: number;
}

interface Ob11MessageSegment {
  type?: string;
  data?: Record<string, unknown>;
}

interface Ob11MetaEvent {
  post_type: 'meta_event';
  meta_event_type: 'lifecycle' | 'heartbeat';
  sub_type?: string;
  self_id: number;
  time: number;
}

interface Ob11ApiResponse {
  status: string;
  retcode: number;
  data: unknown;
  echo?: string;
  message?: string;
  wording?: string;
}

interface AccountConnection {
  socket: WebSocket;
  selfId: string;
  status: 'connecting' | 'connected' | 'offline' | 'error';
  displayName?: string;
  groupList: UnifiedGroup[];
  pending: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
}

export class OneBot11Adapter extends BaseAdapter {
  readonly platform = 'qq';
  private wss: WebSocketServer | null = null;
  private connections = new Map<WebSocket, AccountConnection>();
  private accounts = new Map<string, AccountConnection>();

  async init(): Promise<void> {
    if (config.onebot.mode !== 'reverse-ws') {
      console.warn(
        `[onebot11] 当前仅实现反向 WS 服务端模式；ONEBOT_MODE=${config.onebot.mode} 将在后续阶段支持。`
      );
    }
  }

  async start(): Promise<void> {
    if (config.onebot.mode !== 'reverse-ws') {
      throw new Error(
        `[onebot11] 暂不支持 ONEBOT_MODE=${config.onebot.mode}，请设置为 reverse-ws`
      );
    }

    this.emitStatus('connecting');
    const { wsPort, wsPath } = config.onebot;

    this.wss = new WebSocketServer({ port: wsPort, path: wsPath });
    this.wss.on('connection', (socket, req) => this.handleConnection(socket, req));
    this.wss.on('listening', () => {
      console.log(
        `[onebot11] 反向 WS 服务已监听 ws://0.0.0.0:${wsPort}${wsPath}，请在 NapCat 中配置 WebSocket 客户端指向此地址`
      );
    });
    this.wss.on('error', (err) => {
      console.error('[onebot11] WS 服务错误:', err);
      this.emitStatus('error', String(err));
    });
  }

  async stop(): Promise<void> {
    for (const connection of this.connections.values()) {
      for (const pending of connection.pending.values()) {
        pending.reject(new Error('[onebot11] 服务正在停止'));
      }
      connection.pending.clear();
      connection.socket.close();
    }
    this.connections.clear();
    this.accounts.clear();
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });
    this.wss = null;
    this.emitStatus('offline');
  }

  private handleConnection(socket: WebSocket, req: IncomingMessage): void {
    // 鉴权：校验 Authorization: Bearer <token>（token 为空时跳过）
    const token = config.onebot.token;
    if (token) {
      const auth = req.headers['authorization'] || '';
      const provided = String(auth).replace(/^Bearer\s+/i, '').trim();
      if (provided !== token) {
        console.warn('[onebot11] 鉴权失败，已拒绝连接');
        socket.close(4001, 'invalid token');
        return;
      }
    }

    console.log('[onebot11] NapCat 已连接');
    const connection: AccountConnection = {
      socket,
      selfId: '',
      status: 'connecting',
      groupList: [],
      pending: new Map(),
    };
    this.connections.set(socket, connection);
    // 等第一帧中的 self_id 再把连接归属到具体 QQ 账号。

    socket.on('message', (raw) => this.handleFrame(socket, raw.toString()));
    socket.on('close', () => {
      const current = this.connections.get(socket);
      this.connections.delete(socket);
      if (current?.selfId && this.accounts.get(current.selfId) === current) {
        this.accounts.delete(current.selfId);
        current.status = 'offline';
        console.log(`[onebot11] 账号 ${current.selfId} 连接已断开`);
        this.emitAccountStatus(
          { selfId: current.selfId, displayName: current.displayName, status: 'offline' },
          'NapCat 连接断开'
        );
      } else {
        console.log('[onebot11] 未识别账号的连接已断开');
      }
      for (const pending of current?.pending.values() || []) {
        pending.reject(new Error('[onebot11] NapCat 连接已断开'));
      }
      current?.pending.clear();
      this.updateAggregateStatus();
    });
    socket.on('error', (err) => console.error('[onebot11] 连接错误:', err));
  }

  private handleFrame(socket: WebSocket, text: string): void {
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return;
    }

    // 动作响应
    const connection = this.connections.get(socket);
    if (!connection) return;
    const asResp = payload as Ob11ApiResponse;
    if (asResp.echo && connection.pending.has(asResp.echo)) {
      const p = connection.pending.get(asResp.echo)!;
      connection.pending.delete(asResp.echo);
      if (asResp.status === 'ok' && asResp.retcode === 0) {
        p.resolve(asResp.data);
      } else {
        p.reject(
          new Error(
            `[onebot11] 动作失败(${asResp.retcode}): ${asResp.wording || asResp.message || '未知错误'}`
          )
        );
      }
      return;
    }

    const anyPayload = payload as { post_type?: string; self_id?: number | string };
    if (anyPayload.self_id !== undefined) {
      this.activateAccount(socket, String(anyPayload.self_id));
    }
    switch (anyPayload.post_type) {
      case 'meta_event':
        this.handleMetaEvent(socket, payload as Ob11MetaEvent);
        break;
      case 'message':
      case 'message_sent':
        this.handleMessageEvent(socket, payload as Ob11GroupMessageEvent);
        break;
      default:
        // notice / request 等事件当前忽略
        break;
    }
  }

  private activateAccount(socket: WebSocket, selfId: string): AccountConnection {
    const connection = this.connections.get(socket);
    if (!connection) throw new Error('[onebot11] 连接不存在');
    if (connection.selfId !== selfId) {
      const previous = this.accounts.get(selfId);
      if (previous && previous !== connection) {
        this.accounts.delete(selfId);
        previous.socket.close(4000, 'same account reconnected');
      }
      connection.selfId = selfId;
      this.accounts.set(selfId, connection);
    }
    if (connection.status !== 'connected') {
      connection.status = 'connected';
      console.log(`[onebot11] 账号连接已就绪，self_id=${selfId}`);
      this.emitAccountStatus({ selfId, displayName: connection.displayName, status: 'connected' });
    }
    this.updateAggregateStatus();
    return connection;
  }

  private updateAggregateStatus(): void {
    const next = this.accounts.size > 0 ? 'connected' : this.wss ? 'offline' : 'offline';
    if (this.status !== next) {
      this.emitStatus(next, this.accounts.size > 0 ? `${this.accounts.size} 个账号已连接` : '等待 NapCat 连接');
    }
  }

  private handleMetaEvent(socket: WebSocket, event: Ob11MetaEvent): void {
    if (event.meta_event_type === 'lifecycle' && event.sub_type === 'connect') {
      this.activateAccount(socket, String(event.self_id));
    } else if (event.meta_event_type === 'heartbeat') {
      this.activateAccount(socket, String(event.self_id));
    }
  }

  private handleMessageEvent(socket: WebSocket, event: Ob11GroupMessageEvent): void {
    const connection = this.activateAccount(socket, String(event.self_id));
    const msg = this.toUnifiedMessage(event, undefined, connection.selfId);
    if (msg) this.emitMessage(msg);
  }

  /** 把 Array/String 两种 OneBot 消息格式统一转换，历史消息也复用这一逻辑。 */
  private toUnifiedMessage(
    event: Ob11GroupMessageEvent,
    fallbackGroupId?: string,
    accountSelfId?: string
  ): UnifiedMessage | null {
    const groupId = event.group_id === undefined ? fallbackGroupId : String(event.group_id);
    if ((event.message_type && event.message_type !== 'group') || !groupId) return null;

    const selfId = String(event.self_id || accountSelfId || '');
    const nicknameCache = new Map<string, string>();
    const normalizedRaw = event.raw_message || this.messageToCqString(event.message);
    const parsed = parseCqCode(normalizedRaw, selfId, (qq) => nicknameCache.get(qq));
    const messageId = event.message_id ?? event.message_seq ?? `${event.time}-${event.user_id ?? 'unknown'}`;

    return {
      platform: this.platform,
      accountSelfId: selfId,
      platformGroupId: groupId,
      platformMessageId: String(messageId),
      senderId: String(event.user_id ?? event.sender?.user_id ?? ''),
      senderName: event.sender?.nickname || String(event.user_id ?? ''),
      senderCard: event.sender?.card,
      senderRole: event.sender?.role,
      content: parsed.text,
      rawContent:
        event.raw_message ||
        (typeof event.message === 'string' ? event.message : JSON.stringify(event.message ?? [])),
      cqParsed: true,
      messageType: 'group',
      subType: event.sub_type,
      seq: event.message_seq,
      timestamp: (event.time ? event.time * 1000 : Date.now()),
      media: parsed.media,
      isAtSelf: parsed.isAtSelf,
    };
  }

  /** 把 OneBot 数组消息序列化为 CQ 字符串，交给现有解析器统一清洗。 */
  private messageToCqString(message: unknown): string {
    if (typeof message === 'string') return message;
    if (!Array.isArray(message)) return '';
    return (message as Ob11MessageSegment[])
      .map((segment) => {
        const type = segment?.type || '';
        const data = segment?.data || {};
        if (type === 'text') return String(data.text ?? '');
        if (!type) return '';
        const params = Object.entries(data)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([key, value]) => `${key}=${this.escapeCqValue(String(value))}`)
          .join(',');
        return `[CQ:${type}${params ? `,${params}` : ''}]`;
      })
      .join('');
  }

  private escapeCqValue(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/\[/g, '&#91;').replace(/\]/g, '&#93;').replace(/,/g, '&#44;');
  }

  /** 通过 WS 下发 OneBot 动作并等待响应 */
  private callAction<T = unknown>(
    accountSelfId: string | undefined,
    action: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const connected = Array.from(this.accounts.values()).filter(
        (connection) => connection.status === 'connected' && connection.socket.readyState === WebSocket.OPEN
      );
      const connection = accountSelfId
        ? this.accounts.get(accountSelfId)
        : connected.length === 1
          ? connected[0]
          : undefined;
      if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
        reject(
          new Error(
            accountSelfId
              ? `[onebot11] QQ 账号 ${accountSelfId} 当前未连接`
              : '[onebot11] 当前没有唯一可用的 NapCat 账号连接'
          )
        );
        return;
      }
      const echo = uuidv4();
      const timeout = setTimeout(() => {
        connection.pending.delete(echo);
        reject(new Error(`[onebot11] 动作 ${action} 超时`));
      }, 15000);

      connection.pending.set(echo, {
        resolve: (v) => {
          clearTimeout(timeout);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timeout);
          reject(e);
        },
      });

      connection.socket.send(JSON.stringify({ action, params, echo }));
    });
  }

  /** 拉取并缓存群列表 */
  async refreshGroups(accountSelfId?: string): Promise<UnifiedGroup[]> {
    const resolvedSelfId = accountSelfId || (this.accounts.size === 1 ? this.accounts.keys().next().value : undefined);
    const connection = resolvedSelfId ? this.accounts.get(resolvedSelfId) : undefined;
    const list = await this.callAction<
      Array<{ group_id: number; group_name: string; member_count?: number; max_member_count?: number }>
    >(resolvedSelfId, 'get_group_list');

    const groupList = (list || []).map((g) => ({
      platformGroupId: String(g.group_id),
      name: g.group_name,
      memberCount: g.member_count,
      maxMemberCount: g.max_member_count,
    }));
    if (connection) connection.groupList = groupList;
    return groupList;
  }

  async getGroups(accountSelfId?: string): Promise<UnifiedGroup[]> {
    const connection = accountSelfId ? this.accounts.get(accountSelfId) : undefined;
    if (connection?.socket.readyState === WebSocket.OPEN || (!accountSelfId && this.accounts.size === 1)) {
      return this.refreshGroups(accountSelfId);
    }
    return connection?.groupList || [];
  }

  async getGroupHistory(
    platformGroupId: string,
    options: GroupHistoryOptions,
    accountSelfId?: string
  ): Promise<UnifiedMessage[]> {
    let result: { messages?: Ob11GroupMessageEvent[] } | Ob11GroupMessageEvent[];
    try {
      result = await this.callAction<
        { messages?: Ob11GroupMessageEvent[] } | Ob11GroupMessageEvent[]
      >(accountSelfId, 'get_group_msg_history', {
        group_id: Number(platformGroupId),
        count: options.count,
        // NapCat 会先把这个 OneBot 短消息 ID 还原为内部 MsgId，再向更早处翻页。
        ...(options.beforeMessageId ? { message_seq: options.beforeMessageId } : {}),
        reverse_order: false,
      });
    } catch (err) {
      // NapCat 在已经没有可返回的历史时使用“消息不存在”错误表示翻页结束。
      if (err instanceof Error && /消息.*不存在/.test(err.message)) return [];
      throw err;
    }
    const events = Array.isArray(result) ? result : result?.messages || [];
    return events
      .map((event) => this.toUnifiedMessage(event, platformGroupId, accountSelfId))
      .filter((message): message is UnifiedMessage => Boolean(message))
      .sort((a, b) => a.timestamp - b.timestamp || (a.seq ?? 0) - (b.seq ?? 0));
  }

  getSelfId(): string {
    return this.accounts.keys().next().value || '';
  }

  getAccounts(): PlatformAccountConnection[] {
    return Array.from(this.accounts.values()).map((connection) => ({
      selfId: connection.selfId,
      displayName: connection.displayName,
      status: connection.status,
    }));
  }

  async sendGroupMessage(
    platformGroupId: string,
    text: string,
    accountSelfId?: string
  ): Promise<{ messageId: string }> {
    const result = await this.callAction<{ message_id: number }>(accountSelfId, 'send_group_msg', {
      group_id: Number(platformGroupId),
      message: text,
    });
    return { messageId: String(result?.message_id ?? '') };
  }
}

export default OneBot11Adapter;
