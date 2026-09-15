/**
 * 平台适配器统一抽象
 *
 * 设计目标：把「不同社交平台的消息源」抽象成同一个接口，
 * 上层（接入管道 / 总结引擎 / 通知）只依赖这里的统一模型，
 * 从而在 QQ（OneBot 11）之外，后续可以平滑接入飞书 / 微信 / Telegram / Discord 等。
 */

export type AdapterStatus = 'offline' | 'connecting' | 'connected' | 'error';

export interface UnifiedGroup {
  platformGroupId: string;
  name: string;
  memberCount?: number;
  maxMemberCount?: number;
  avatar?: string;
}

export interface UnifiedMember {
  userId: string;
  nickname: string;
  card?: string;
  role?: 'owner' | 'admin' | 'member';
}

export type MediaType = 'image' | 'voice' | 'file' | 'video';

export interface UnifiedMedia {
  type: MediaType;
  url?: string;
  /** base64:// 或本地路径 / file_id */
  file?: string;
}

export interface UnifiedMessage {
  /** 平台标识：'qq' | 'wechat' | 'telegram' | ... */
  platform: string;
  /** 接收该消息的平台登录账号，用于多账号隔离。 */
  accountSelfId?: string;
  /** 平台内群号 */
  platformGroupId: string;
  /** 平台内消息 ID（去重键） */
  platformMessageId: string;
  senderId: string;
  senderName: string;
  senderCard?: string;
  senderRole?: string;
  /** CQ 码解析后的纯文本 */
  content: string;
  /** 平台原始内容（可能含 CQ 码） */
  rawContent: string;
  cqParsed: boolean;
  messageType: 'group' | 'private';
  subType?: string;
  /** 消息序号（用于同秒内排序） */
  seq?: number;
  /** 消息发生时间（epoch ms） */
  timestamp: number;
  media?: UnifiedMedia[];
  /** 是否 @ 了机器人自己 */
  isAtSelf?: boolean;
}

export interface PlatformAccountConnection {
  selfId: string;
  displayName?: string;
  status: AdapterStatus;
}

export interface GroupHistoryOptions {
  /** 单页读取数量 */
  count: number;
  /**
   * 从该消息继续向更早的方向读取。
   *
   * OneBot/NapCat 的动作参数虽然名为 message_seq，实际也接受并优先解析
   * OneBot message_id；统一层使用 messageId 命名，避免把 QQ 的内部 seq 当成游标。
   */
  beforeMessageId?: string;
}

export interface PlatformAdapter {
  /** 平台标识 */
  readonly platform: string;

  /** 初始化（建连前的准备，可选） */
  init(): Promise<void>;

  /** 启动：建立连接 / 开始监听 */
  start(): Promise<void>;

  /** 停止并释放资源 */
  stop(): Promise<void>;

  /** 当前连接状态 */
  getStatus(): AdapterStatus;

  /** 机器人自身账号 ID（用于平台账号归集） */
  getSelfId(): string;

  /** 拉取群列表 */
  /** 当前适配器内已识别的账号连接。 */
  getAccounts(): PlatformAccountConnection[];

  getGroups(accountSelfId?: string): Promise<UnifiedGroup[]>;

  /** 拉取群成员（可选能力） */
  getGroupMembers?(platformGroupId: string): Promise<UnifiedMember[]>;

  /** 拉取群历史消息（可选能力；仅应在用户明确授权后调用） */
  getGroupHistory?(
    platformGroupId: string,
    options: GroupHistoryOptions,
    accountSelfId?: string
  ): Promise<UnifiedMessage[]>;

  /** 发送群消息 */
  sendGroupMessage(platformGroupId: string, text: string, accountSelfId?: string): Promise<{ messageId: string }>;

  /** 订阅新消息 */
  onMessage(handler: (msg: UnifiedMessage) => void): void;

  /** 订阅状态变化（可选能力） */
  onStatusChange?(handler: (status: AdapterStatus, info?: string) => void): void;

  onAccountStatusChange?(
    handler: (account: PlatformAccountConnection, info?: string) => void
  ): void;
}

/** 适配器公共基类：统一实现监听器注册，子类只需实现 start/stop/getGroups/send 等 */
export abstract class BaseAdapter implements PlatformAdapter {
  abstract readonly platform: string;
  protected status: AdapterStatus = 'offline';
  private messageHandlers: Array<(msg: UnifiedMessage) => void> = [];
  private statusHandlers: Array<(status: AdapterStatus, info?: string) => void> = [];
  private accountStatusHandlers: Array<(account: PlatformAccountConnection, info?: string) => void> = [];

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract getGroups(): Promise<UnifiedGroup[]>;
  abstract getSelfId(): string;
  abstract sendGroupMessage(platformGroupId: string, text: string): Promise<{ messageId: string }>;

  async init(): Promise<void> {
    // 默认无操作，子类按需覆盖
  }

  getStatus(): AdapterStatus {
    return this.status;
  }

  getAccounts(): PlatformAccountConnection[] {
    const selfId = this.getSelfId();
    return selfId ? [{ selfId, status: this.status }] : [];
  }

  onMessage(handler: (msg: UnifiedMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onStatusChange(handler: (status: AdapterStatus, info?: string) => void): void {
    this.statusHandlers.push(handler);
  }

  onAccountStatusChange(handler: (account: PlatformAccountConnection, info?: string) => void): void {
    this.accountStatusHandlers.push(handler);
  }

  /** 子类在收到消息后调用，向所有订阅者派发 */
  protected emitMessage(msg: UnifiedMessage): void {
    for (const h of this.messageHandlers) {
      try {
        h(msg);
      } catch (err) {
        console.error(`[${this.platform}] message handler error:`, err);
      }
    }
  }

  /** 子类在状态变化时调用 */
  protected emitStatus(status: AdapterStatus, info?: string): void {
    this.status = status;
    for (const h of this.statusHandlers) {
      try {
        h(status, info);
      } catch (err) {
        console.error(`[${this.platform}] status handler error:`, err);
      }
    }
  }

  protected emitAccountStatus(account: PlatformAccountConnection, info?: string): void {
    for (const handler of this.accountStatusHandlers) {
      try {
        handler(account, info);
      } catch (err) {
        console.error(`[${this.platform}] account status handler error:`, err);
      }
    }
  }
}
