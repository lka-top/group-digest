import { useMemo, useState } from 'react';
import { Input, Select, Button, Tag, Loading, Empty, Pagination, DateRangePicker } from 'tdesign-react';
import { RefreshIcon } from 'tdesign-icons-react';
import { useGroups } from '../hooks/useGroups';
import { useMessages, type MessageFilters } from '../hooks/useMessages';
import { formatDateTime } from '../api';
import { accountLabel, groupLabel, platformLabel } from '../utils/sourceLabel';
import type { Group } from '../types';

interface MessagesPageProps {
  refreshKey: number;
}

const ROLE_LABEL: Record<string, string> = { owner: '群主', admin: '管理员', member: '成员' };

export function MessagesPage({ refreshKey }: MessagesPageProps) {
  const { groups } = useGroups(0);
  const [platform, setPlatform] = useState('');
  const [platformAccountId, setPlatformAccountId] = useState('');
  const [groupId, setGroupId] = useState<string>('');
  const [keyword, setKeyword] = useState('');
  const [range, setRange] = useState<[string, string] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const platformOptions = useMemo(
    () => Array.from(new Set(groups.map((group) => group.platform))).sort(),
    [groups]
  );
  const accountOptions = useMemo(() => {
    const unique = new Map<string, Group>();
    groups.forEach((group) => {
      if ((!platform || group.platform === platform) && !unique.has(group.platform_account_id)) {
        unique.set(group.platform_account_id, group);
      }
    });
    return Array.from(unique.values());
  }, [groups, platform]);
  const groupOptions = useMemo(
    () =>
      groups.filter(
        (group) =>
          (!platform || group.platform === platform) &&
          (!platformAccountId || group.platform_account_id === platformAccountId)
      ),
    [groups, platform, platformAccountId]
  );

  const filters: MessageFilters = useMemo(
    () => ({
      platform: platform || undefined,
      platformAccountId: platformAccountId || undefined,
      groupId: groupId || undefined,
      keyword: keyword || undefined,
      start: range?.[0] ? new Date(range[0]).toISOString() : undefined,
      end: range?.[1] ? new Date(range[1]).toISOString() : undefined,
      page,
      pageSize,
      order: 'desc',
    }),
    [platform, platformAccountId, groupId, keyword, range, page, pageSize]
  );

  const { items, total, loading, refresh } = useMessages(filters, refreshKey);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
            群消息
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>
            浏览已采集的群聊消息，可按平台、登录账号、群聊与时间范围检索
          </p>
        </div>
        <Button variant="outline" icon={<RefreshIcon />} onClick={() => void refresh()} loading={loading}>
          刷新
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          value={platform}
          placeholder="全部平台"
          clearable
          style={{ width: 150 }}
          options={platformOptions.map((value) => ({ label: platformLabel(value), value }))}
          onChange={(value) => {
            setPlatform((value as string) || '');
            setPlatformAccountId('');
            setGroupId('');
            setPage(1);
          }}
        />
        <Select
          value={platformAccountId}
          placeholder="全部登录账号"
          clearable
          style={{ width: 240 }}
          options={accountOptions.map((group) => ({
            label: `${platformLabel(group.platform)} · ${accountLabel(group)}`,
            value: group.platform_account_id,
          }))}
          onChange={(value) => {
            setPlatformAccountId((value as string) || '');
            setGroupId('');
            setPage(1);
          }}
        />
        <Select
          value={groupId}
          placeholder="全部群聊"
          clearable
          style={{ width: 280 }}
          options={groupOptions.map((group) => ({
            label: `${groupLabel(group)} · ${group.message_count} 条`,
            value: group.id,
          }))}
          onChange={(v) => {
            setGroupId((v as string) || '');
            setPage(1);
          }}
        />
        <Input
          value={keyword}
          placeholder="搜索消息内容 / 发送者"
          clearable
          style={{ width: 240 }}
          onChange={(v) => {
            setKeyword(v as string);
            setPage(1);
          }}
        />
        <DateRangePicker
          value={range ?? undefined}
          clearable
          style={{ width: 320 }}
          placeholder={['开始时间', '结束时间']}
          onChange={(v) => {
            const arr = v as [string, string] | null;
            setRange(arr && arr[0] && arr[1] ? [arr[0], arr[1]] : null);
            setPage(1);
          }}
        />
        <div className="flex items-center text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
          共 {total} 条
        </div>
      </div>

      <Loading loading={loading}>
        {items.length === 0 ? (
          <Empty description="暂无消息" />
        ) : (
          <div
            className="rounded-lg border divide-y"
            style={{ borderColor: 'var(--td-component-border)' }}
          >
            {items.map((m) => (
              <div key={m.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <Tag size="small" theme="primary" variant="light">{platformLabel(m.platform)}</Tag>
                  <Tag size="small" variant="outline">账号 {accountLabel(m)}</Tag>
                  <Tag size="small" variant="outline">群聊 {groupLabel(m)}</Tag>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                    {m.sender_card || m.sender_name || m.sender_id}
                  </span>
                  {m.sender_role && ROLE_LABEL[m.sender_role] && (
                    <Tag size="small" variant="outline" theme={m.sender_role === 'member' ? 'default' : 'primary'}>
                      {ROLE_LABEL[m.sender_role]}
                    </Tag>
                  )}
                  <Tag
                    size="small"
                    variant="light"
                    theme={m.ingest_source === 'backfill' ? 'warning' : 'success'}
                  >
                    {m.ingest_source === 'backfill' ? '历史回填' : '实时监控'}
                  </Tag>
                  <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                    {formatDateTime(m.timestamp)}
                  </span>
                </div>
                <div className="text-sm whitespace-pre-wrap break-words" style={{ color: 'var(--td-text-color-secondary)' }}>
                  {m.content}
                </div>
              </div>
            ))}
          </div>
        )}
      </Loading>

      {total > 0 && (
        <div className="flex justify-center mt-4">
          <Pagination
            total={total}
            current={page}
            pageSize={pageSize}
            showJumper
            pageSizeOptions={[20, 50, 100, 200]}
            onChange={(info) => {
              setPage(info.current);
              setPageSize(info.pageSize);
            }}
          />
        </div>
      )}
    </div>
  );
}
