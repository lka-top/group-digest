/**
 * 进程内事件总线
 * 用于把「新消息入库 / 新总结生成 / 即时提醒 / 适配器状态变化」广播给
 * 全局 SSE 端点（/api/events），实现前端实时更新。
 */
import { EventEmitter } from 'events';

export interface GroupMessageEventPayload {
  id: string;
  groupId: string;
  groupName?: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  priority?: number;
}

export type AppEvent =
  | { type: 'message'; groupId: string; message: GroupMessageEventPayload }
  | { type: 'summary'; groupId: string; summaryId: string; title: string; status: string }
  | {
      type: 'instant';
      groupId: string | null;
      notificationId: string;
      title: string;
      priority: number;
    }
  | { type: 'status'; adapter: string; status: string; info?: string }
  | { type: 'groups_synced'; adapter: string; count: number }
  | { type: 'group_config'; count: number };

class AppEventBus extends EventEmitter {
  private static readonly CHANNEL = 'app-event';

  constructor() {
    super();
    // 多个 SSE 连接 + 内部订阅者，放大监听上限
    this.setMaxListeners(200);
  }

  emitEvent(event: AppEvent): void {
    this.emit(AppEventBus.CHANNEL, event);
  }

  /** 订阅事件，返回取消订阅函数 */
  onEvent(listener: (event: AppEvent) => void): () => void {
    this.on(AppEventBus.CHANNEL, listener);
    return () => this.off(AppEventBus.CHANNEL, listener);
  }
}

export const eventBus = new AppEventBus();
export default eventBus;
