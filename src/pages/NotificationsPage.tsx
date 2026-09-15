import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Tag, Empty, Loading, MessagePlugin, Switch } from 'tdesign-react';
import { RefreshIcon, CheckCircleIcon } from 'tdesign-icons-react';
import { formatDateTime, formatRelative } from '../api';
import type { AppNotification } from '../types';

interface NotificationsPageProps {
  notifications: AppNotification[];
  unread: number;
  loading: boolean;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const TYPE_TAG: Record<string, { label: string; theme: 'primary' | 'danger' | 'success' | 'default' }> = {
  summary: { label: '总结', theme: 'success' },
  instant: { label: '即时提醒', theme: 'danger' },
  system: { label: '系统', theme: 'default' },
};

export function NotificationsPage({
  notifications,
  unread,
  loading,
  refresh,
  markRead,
  markAllRead,
}: NotificationsPageProps) {
  const [desktopEnabled, setDesktopEnabled] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  );
  const seenRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  // 桌面通知（浏览器 Notification API）
  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    if (!initializedRef.current) {
      notifications.forEach((n) => seenRef.current.add(n.id));
      initializedRef.current = true;
      return;
    }
    if (!desktopEnabled || Notification.permission !== 'granted') return;
    for (const n of notifications) {
      if (!seenRef.current.has(n.id)) {
        seenRef.current.add(n.id);
        try {
          new Notification(n.title, { body: n.body.slice(0, 120) });
        } catch {
          /* 忽略 */
        }
      }
    }
  }, [notifications, desktopEnabled]);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') {
      MessagePlugin.warning('当前浏览器不支持桌面通知');
      return;
    }
    const perm = await Notification.requestPermission();
    setDesktopEnabled(perm === 'granted');
    if (perm === 'granted') MessagePlugin.success('已开启桌面通知');
    else MessagePlugin.warning('未获得通知权限');
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
            通知中心
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>
            总结生成通知与高优先级即时提醒（未读 {unread} 条）
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
              桌面通知
            </span>
            <Switch value={desktopEnabled} onChange={(v) => (v ? void requestPermission() : setDesktopEnabled(false))} />
          </div>
          <Button variant="outline" icon={<RefreshIcon />} onClick={() => void refresh()} loading={loading}>
            刷新
          </Button>
          <Button variant="outline" icon={<CheckCircleIcon />} onClick={() => void markAllRead()}>
            全部已读
          </Button>
        </div>
      </div>

      <Loading loading={loading && notifications.length === 0}>
        {notifications.length === 0 ? (
          <Empty description="暂无通知" />
        ) : (
          <div className="space-y-3">
            {notifications.map((n) => {
              const tag = TYPE_TAG[n.type] || TYPE_TAG.system;
              return (
                <Card
                  key={n.id}
                  className={n.read === 0 ? 'notification-unread' : ''}
                  title={
                    <div className="flex items-center gap-2">
                      <Tag size="small" theme={tag.theme} variant={n.type === 'instant' ? 'light' : 'outline'}>
                        {tag.label}
                      </Tag>
                      <span className="font-medium">{n.title}</span>
                      {n.read === 0 && (
                        <Tag size="small" theme="warning" variant="light">
                          未读
                        </Tag>
                      )}
                    </div>
                  }
                  subtitle={formatDateTime(n.created_at)}
                  actions={
                    n.read === 0 ? (
                      <Button variant="text" size="small" onClick={() => void markRead(n.id)}>
                        标为已读
                      </Button>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                        {formatRelative(n.created_at)}
                      </span>
                    )
                  }
                >
                  <div
                    className="text-sm whitespace-pre-wrap break-words max-h-64 overflow-y-auto"
                    style={{ color: 'var(--td-text-color-secondary)' }}
                  >
                    {n.body}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Loading>
    </div>
  );
}
