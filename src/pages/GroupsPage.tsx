import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Input, InputNumber, Select, Tag, MessagePlugin, Loading, Empty } from 'tdesign-react';
import { RefreshIcon, SwapIcon } from 'tdesign-icons-react';
import { useGroups } from '../hooks/useGroups';
import { formatDateTime, formatRelative } from '../api';
import { accountLabel, platformLabel } from '../utils/sourceLabel';
import type { DashboardData, Group, GroupProcessingMode } from '../types';

interface GroupsPageProps {
  refreshKey: number;
  dashboard?: DashboardData;
}

type PolicyTarget =
  | { scope: 'all' }
  | { scope: 'platform'; platform: string }
  | { scope: 'account'; platform_account_id: string };

const PROCESSING_MODE_OPTIONS = [
  { label: '不处理', value: 'off' },
  { label: '仅记录消息', value: 'record' },
  { label: '自动总结', value: 'summary' },
  { label: '总结并推送', value: 'push' },
];

const PRIORITY_OPTIONS = [
  { label: '普通（0）', value: 0 },
  { label: '重要（500）', value: 500 },
  { label: '紧急（900）', value: 900 },
];

function processingMode(group: Group): GroupProcessingMode {
  if (group.enabled !== 1) return 'off';
  if (group.summary_enabled !== 1) return 'record';
  return group.push_enabled === 1 ? 'push' : 'summary';
}

function commonMode(groups: Group[]): GroupProcessingMode | 'mixed' {
  const first = groups[0] ? processingMode(groups[0]) : 'off';
  return groups.every((group) => processingMode(group) === first) ? first : 'mixed';
}

function commonPriority(groups: Group[]): number | 'mixed' {
  const first = groups[0]?.priority ?? 0;
  return groups.every((group) => group.priority === first) ? first : 'mixed';
}

function modeLabel(mode: GroupProcessingMode): string {
  return PROCESSING_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

function policySourceLabel(source: Group['mode_source']): string {
  if (source === 'account') return '账号继承';
  if (source === 'platform') return '平台继承';
  if (source === 'root') return '全局默认';
  return '群自定义';
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div
      className="min-w-0 rounded-lg border px-3 py-3"
      style={{
        borderColor: 'var(--td-component-border)',
        backgroundColor: 'var(--td-bg-color-container)',
      }}
    >
      <div className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>{hint}</div>}
    </div>
  );
}

function isAccountConnected(dashboard: DashboardData | undefined, source: Group): boolean {
  return Boolean(
    dashboard?.adapter.platform === source.platform &&
      dashboard.adapter.accounts.some(
        (account) => account.selfId === source.account_self_id && account.status === 'connected'
      )
  );
}

export function GroupsPage({ refreshKey, dashboard }: GroupsPageProps) {
  const { groups, loading, refresh, updateConfig, updatePolicyByScope, inheritPolicy, sync, backfillHistory } = useGroups(refreshKey);
  const [syncing, setSyncing] = useState(false);
  const [backfillingGroupId, setBackfillingGroupId] = useState('');
  const [updatingNode, setUpdatingNode] = useState('');
  const [historyCount, setHistoryCount] = useState(100);
  const [keyword, setKeyword] = useState('');
  const [platformFilter, setPlatformFilter] = useState('current');
  const [accountFilter, setAccountFilter] = useState('all');
  const normalizedKeyword = keyword.trim().toLocaleLowerCase();

  const selectedPlatform =
    platformFilter === 'current' ? dashboard?.adapter.platform : platformFilter === 'all' ? undefined : platformFilter;
  const platformOptions = useMemo(
    () => Array.from(new Set(groups.map((group) => group.platform))).sort(),
    [groups]
  );
  const accountOptions = useMemo(() => {
    const unique = new Map<string, Group>();
    groups.forEach((group) => {
      if ((!selectedPlatform || group.platform === selectedPlatform) && !unique.has(group.platform_account_id)) {
        unique.set(group.platform_account_id, group);
      }
    });
    return Array.from(unique.values());
  }, [groups, selectedPlatform]);

  const filteredGroups = useMemo(() => {
    return groups.filter((group) => {
      if (selectedPlatform && group.platform !== selectedPlatform) return false;
      if (accountFilter !== 'all' && group.platform_account_id !== accountFilter) return false;
      if (!normalizedKeyword) return true;
      return (
        group.name.toLocaleLowerCase().includes(normalizedKeyword) ||
        group.platform_group_id.toLocaleLowerCase().includes(normalizedKeyword) ||
        platformLabel(group.platform).toLocaleLowerCase().includes(normalizedKeyword) ||
        accountLabel(group).toLocaleLowerCase().includes(normalizedKeyword)
      );
    });
  }, [accountFilter, groups, normalizedKeyword, selectedPlatform]);

  const platformTree = useMemo(() => {
    const platforms = new Map<
      string,
      { platform: string; accounts: Map<string, { source: Group; groups: Group[] }> }
    >();
    filteredGroups.forEach((group) => {
      let platform = platforms.get(group.platform);
      if (!platform) {
        platform = { platform: group.platform, accounts: new Map() };
        platforms.set(group.platform, platform);
      }
      const accountKey = group.platform_account_id;
      const account = platform.accounts.get(accountKey);
      if (account) account.groups.push(group);
      else platform.accounts.set(accountKey, { source: group, groups: [group] });
    });
    return Array.from(platforms.values()).map((platform) => ({
      platform: platform.platform,
      accounts: Array.from(platform.accounts.values()),
    }));
  }, [filteredGroups]);

  const hasTreeFilter =
    Boolean(normalizedKeyword) || accountFilter !== 'all' || platformFilter !== 'current';
  const visibleAccountCount = platformTree.reduce((sum, platform) => sum + platform.accounts.length, 0);

  useEffect(() => {
    if (!normalizedKeyword || filteredGroups.length === 0) return;
    const directGroup = filteredGroups.find(
      (group) =>
        group.name.toLocaleLowerCase().includes(normalizedKeyword) ||
        group.platform_group_id.toLocaleLowerCase().includes(normalizedKeyword)
    );
    const accountGroup = filteredGroups.find((group) =>
      accountLabel(group).toLocaleLowerCase().includes(normalizedKeyword)
    );
    const platformGroup = filteredGroups.find((group) =>
      platformLabel(group.platform).toLocaleLowerCase().includes(normalizedKeyword)
    );
    const targetId = directGroup
      ? `group-tree-${directGroup.id}`
      : accountGroup
        ? `account-tree-${accountGroup.platform_account_id}`
        : platformGroup
          ? `platform-tree-${platformGroup.platform}`
          : undefined;
    if (!targetId) return;
    const timer = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [filteredGroups, normalizedKeyword]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await sync();
      const detail = `${res.accounts ?? 1} 个在线账号，共 ${res.total} 个群，新增 ${res.created}，更新 ${res.updated}`;
      if (res.failedAccounts?.length) {
        MessagePlugin.warning(`部分同步完成：${detail}；失败账号 ${res.failedAccounts.join('、')}`);
      } else {
        MessagePlugin.success(`同步完成：${detail}`);
      }
    } catch (err) {
      MessagePlugin.error(err instanceof Error ? err.message : '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const guard = async (fn: () => Promise<unknown>, okMsg?: string) => {
    try {
      await fn();
      if (okMsg) MessagePlugin.success(okMsg);
    } catch (err) {
      MessagePlugin.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleBackfill = async (group: Group) => {
    const confirmed = window.confirm(
      `确认从 ${platformLabel(group.platform)} 账号 ${accountLabel(group)} 读取“${group.name}”最近 ${historyCount} 条历史消息？这可能包含本次授权开始前的消息，请确保已获得相应授权。`
    );
    if (!confirmed) return;
    setBackfillingGroupId(group.id);
    try {
      const result = await backfillHistory(group.id, historyCount);
      MessagePlugin.success(`回填完成：获取 ${result.fetched} 条，新增保存 ${result.stored} 条`);
    } catch (err) {
      MessagePlugin.error(err instanceof Error ? err.message : '历史消息回填失败');
    } finally {
      setBackfillingGroupId('');
    }
  };

  const handleNodePolicy = async (
    nodeKey: string,
    target: PolicyTarget,
    updates: { processing_mode?: GroupProcessingMode; priority?: number },
    nodeLabel: string
  ) => {
    setUpdatingNode(nodeKey);
    try {
      const result = await updatePolicyByScope(target, updates);
      const change = updates.processing_mode
        ? `处理模式已设为“${modeLabel(updates.processing_mode)}”`
        : `优先级已设为 ${updates.priority}`;
      MessagePlugin.success(`${nodeLabel}${change}，已应用到 ${result.matched} 个群`);
    } catch (err) {
      MessagePlugin.error(err instanceof Error ? err.message : '批量更新失败');
    } finally {
      setUpdatingNode('');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
            群聊管理
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>
            用处理模式统一控制读取、总结与推送，并按平台、账号或群设置重要程度
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" icon={<RefreshIcon />} onClick={() => void refresh()} loading={loading}>
            刷新
          </Button>
          <Button theme="primary" icon={<SwapIcon />} onClick={handleSync} loading={syncing}>
            同步所有在线账号
          </Button>
        </div>
      </div>

      {dashboard && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5 xl:grid-cols-10">
          <StatCard label="已接入平台" value={dashboard.stats.platforms} />
          <StatCard label="接入账号" value={dashboard.stats.accounts} hint={`${dashboard.stats.connectedAccounts} 个在线`} />
          <StatCard label="已接入群" value={dashboard.stats.groups} />
          <StatCard label="启用中" value={dashboard.stats.enabledGroups} />
          <StatCard label="消息总量" value={dashboard.stats.messages} />
          <StatCard label="24 小时消息" value={dashboard.stats.messages24h} />
          <StatCard label="已生成总结" value={dashboard.stats.summaries} />
          <StatCard label="未读通知" value={dashboard.stats.unreadNotifications} />
          <StatCard label="适配器" value={dashboard.adapter.kind} />
          <StatCard
            label="连接状态"
            value={dashboard.adapter.status === 'connected' ? '已连接' : dashboard.adapter.status}
            hint={`${dashboard.stats.connectedAccounts} 个账号在线`}
          />
        </div>
      )}

      {dashboard?.adapter.kind === 'onebot11' && (
        <Alert
          className="mb-4"
          theme="info"
          title="多个账号可同时在线，群聊独立授权"
          message="每个 NapCat 账号可同时连接同一 OneBot 地址。选择“仅记录消息”“自动总结”或“总结并推送”都会记录授权时间并持续接收新消息；父节点策略会应用到全部下级群，之后新同步的群也会继承最近下发的默认策略。"
        />
      )}

      <Card className="mb-4" title="接入数据结构与群聊配置">
        <div className="space-y-4 pt-1">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3" style={{ borderColor: 'var(--td-component-border)' }}>
            <Input
              className="min-w-64 max-w-md"
              value={keyword}
              clearable
              placeholder="搜索平台、账号、群名或群号"
              onChange={(value) => setKeyword(value)}
            />
            <Select
              className="w-44"
              value={platformFilter}
              options={[
                { label: `当前平台（${dashboard?.adapter.platform ?? '加载中'}）`, value: 'current' },
                ...platformOptions.map((platform) => ({ label: platformLabel(platform), value: platform })),
                { label: '全部平台', value: 'all' },
              ]}
              onChange={(value) => {
                setPlatformFilter(String(value));
                setAccountFilter('all');
              }}
            />
            <Select
              className="w-56"
              value={accountFilter}
              options={[
                { label: '全部登录账号', value: 'all' },
                ...accountOptions.map((group) => ({
                  label: `${platformLabel(group.platform)} · ${accountLabel(group)}`,
                  value: group.platform_account_id,
                })),
              ]}
              onChange={(value) => setAccountFilter(String(value))}
            />
            <span className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
              {hasTreeFilter ? `已定位 ${filteredGroups.length} / ${groups.length} 个群` : `共 ${groups.length} 个群`}
            </span>
            <span className="ml-auto text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
              单次历史回填
            </span>
            <InputNumber
              value={historyCount}
              min={1}
              max={200}
              step={10}
              suffix="条"
              style={{ width: 120 }}
              onChange={(value) => setHistoryCount(Math.max(1, Math.min(200, Number(value ?? 100))))}
            />
          </div>

          <Loading loading={loading && groups.length === 0}>
            {groups.length === 0 ? (
              <Empty description="暂无群数据，请先同步在线账号" />
            ) : filteredGroups.length === 0 ? (
              <Empty description="没有符合搜索或筛选条件的树节点" />
            ) : (
              <div>
                <div
                  className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3"
                  style={{ borderColor: 'var(--td-brand-color)', background: 'var(--td-brand-color-light)' }}
                >
                  <Tag theme="primary" variant="light">根节点</Tag>
                  <span className="font-medium" style={{ color: 'var(--td-text-color-primary)' }}>全部接入源</span>
                  <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
                    {platformTree.length} 个平台 · {visibleAccountCount} 个账号 · {filteredGroups.length} 个群聊
                  </span>
                  {hasTreeFilter && <Tag size="small" theme="primary" variant="outline">仅显示匹配路径</Tag>}
                  <div
                    className="ml-auto flex flex-wrap items-center gap-2"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
                      全部群处理模式
                    </span>
                    <Select
                      size="small"
                      style={{ width: 130 }}
                      value={commonMode(groups)}
                      options={commonMode(groups) === 'mixed'
                        ? [{ label: '混合配置', value: 'mixed', disabled: true }, ...PROCESSING_MODE_OPTIONS]
                        : PROCESSING_MODE_OPTIONS}
                      disabled={Boolean(updatingNode)}
                      onChange={(value) =>
                        void handleNodePolicy(
                          'root',
                          { scope: 'all' },
                          { processing_mode: value as GroupProcessingMode },
                          '全部接入源：'
                        )
                      }
                    />
                    <span className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>默认优先级</span>
                    <Select
                      size="small"
                      style={{ width: 125 }}
                      value={commonPriority(groups)}
                      options={commonPriority(groups) === 'mixed'
                        ? [{ label: '混合配置', value: 'mixed', disabled: true }, ...PRIORITY_OPTIONS]
                        : PRIORITY_OPTIONS.some((option) => option.value === commonPriority(groups))
                          ? PRIORITY_OPTIONS
                          : [{ label: `自定义（${commonPriority(groups)}）`, value: commonPriority(groups) }, ...PRIORITY_OPTIONS]}
                      disabled={Boolean(updatingNode)}
                      loading={updatingNode === 'root'}
                      onChange={(value) =>
                        void handleNodePolicy('root', { scope: 'all' }, { priority: Number(value) }, '全部接入源：')
                      }
                    />
                  </div>
                </div>

                <div className="ml-5 border-l pl-5 pt-3" style={{ borderColor: 'var(--td-component-border)' }}>
                  {platformTree.map((platform) => {
                    const platformGroups = groups.filter((group) => group.platform === platform.platform);
                    const platformMode = commonMode(platformGroups);
                    const platformPriority = commonPriority(platformGroups);
                    const messageCount = platformGroups.reduce((sum, group) => sum + group.message_count, 0);
                    const platformMatched = platformLabel(platform.platform)
                      .toLocaleLowerCase()
                      .includes(normalizedKeyword);
                    return (
                      <details
                        id={`platform-tree-${platform.platform}`}
                        key={`${platform.platform}:${hasTreeFilter}`}
                        open
                        className="mb-3"
                      >
                        <summary
                          className="cursor-pointer rounded-lg px-3 py-2"
                          style={{
                            background:
                              normalizedKeyword && platformMatched
                                ? 'var(--td-brand-color-light)'
                                : 'var(--td-bg-color-secondarycontainer)',
                          }}
                        >
                          <span className="ml-2 font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                            {platformLabel(platform.platform)} 平台
                          </span>
                          <span className="ml-3 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                            {platform.accounts.length} 个账号 · {platformGroups.length} 个群聊 · {messageCount} 条消息
                          </span>
                          <span
                            className="float-right ml-3 inline-flex flex-wrap items-center gap-2"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                          >
                            <span className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
                              该平台所有群
                            </span>
                            <Select
                              size="small"
                              style={{ width: 130 }}
                              value={platformMode}
                              options={platformMode === 'mixed'
                                ? [{ label: '混合配置', value: 'mixed', disabled: true }, ...PROCESSING_MODE_OPTIONS]
                                : PROCESSING_MODE_OPTIONS}
                              disabled={Boolean(updatingNode)}
                              onChange={(value) =>
                                void handleNodePolicy(
                                  `platform:${platform.platform}`,
                                  { scope: 'platform', platform: platform.platform },
                                  { processing_mode: value as GroupProcessingMode },
                                  `${platformLabel(platform.platform)}平台：`
                                )
                              }
                            />
                            <Select
                              size="small"
                              style={{ width: 115 }}
                              value={platformPriority}
                              options={platformPriority === 'mixed'
                                ? [{ label: '混合优先级', value: 'mixed', disabled: true }, ...PRIORITY_OPTIONS]
                                : PRIORITY_OPTIONS.some((option) => option.value === platformPriority)
                                  ? PRIORITY_OPTIONS
                                  : [{ label: `自定义（${platformPriority}）`, value: platformPriority }, ...PRIORITY_OPTIONS]}
                              disabled={Boolean(updatingNode)}
                              loading={updatingNode === `platform:${platform.platform}`}
                              onChange={(value) =>
                                void handleNodePolicy(
                                  `platform:${platform.platform}`,
                                  { scope: 'platform', platform: platform.platform },
                                  { priority: Number(value) },
                                  `${platformLabel(platform.platform)}平台：`
                                )
                              }
                            />
                          </span>
                        </summary>

                        <div className="ml-5 border-l pl-5 pt-2" style={{ borderColor: 'var(--td-component-border)' }}>
                          {platform.accounts.map(({ source, groups: accountGroups }) => {
                            const allAccountGroups = groups.filter(
                              (group) => group.platform_account_id === source.platform_account_id
                            );
                            const connected = isAccountConnected(dashboard, source);
                            const enabled = allAccountGroups.filter((group) => group.enabled === 1).length;
                            const accountMode = commonMode(allAccountGroups);
                            const accountPriority = commonPriority(allAccountGroups);
                            const accountMessages = allAccountGroups.reduce((sum, group) => sum + group.message_count, 0);
                            const accountMatched = accountLabel(source)
                              .toLocaleLowerCase()
                              .includes(normalizedKeyword);
                            return (
                              <details
                                id={`account-tree-${source.platform_account_id}`}
                                key={`${source.platform_account_id}:${hasTreeFilter}`}
                                open={hasTreeFilter}
                                className="mb-2"
                              >
                                <summary
                                  className="cursor-pointer rounded-lg border px-3 py-2"
                                  style={{
                                    borderColor:
                                      normalizedKeyword && accountMatched
                                        ? 'var(--td-brand-color)'
                                        : 'var(--td-component-border)',
                                    background:
                                      normalizedKeyword && accountMatched
                                        ? 'var(--td-brand-color-light)'
                                        : 'transparent',
                                  }}
                                >
                                  <span className="ml-2 text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                                    账号 {accountLabel(source)}
                                  </span>
                                  <Tag className="ml-2" size="small" theme={connected ? 'success' : 'default'} variant="light">
                                    {connected ? '在线' : '离线'}
                                  </Tag>
                                  <span className="ml-3 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                                    {allAccountGroups.length} 个群 · {enabled} 个启用 · {accountMessages} 条消息
                                  </span>
                                  <span
                                    className="float-right ml-3 inline-flex flex-wrap items-center gap-2"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                    }}
                                  >
                                    <span className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
                                      该账号所有群
                                    </span>
                                    <Select
                                      size="small"
                                      style={{ width: 130 }}
                                      value={accountMode}
                                      options={accountMode === 'mixed'
                                        ? [{ label: '混合配置', value: 'mixed', disabled: true }, ...PROCESSING_MODE_OPTIONS]
                                        : PROCESSING_MODE_OPTIONS}
                                      disabled={Boolean(updatingNode)}
                                      onChange={(value) =>
                                        void handleNodePolicy(
                                          `account:${source.platform_account_id}`,
                                          { scope: 'account', platform_account_id: source.platform_account_id },
                                          { processing_mode: value as GroupProcessingMode },
                                          `账号 ${accountLabel(source)}：`
                                        )
                                      }
                                    />
                                    <Select
                                      size="small"
                                      style={{ width: 115 }}
                                      value={accountPriority}
                                      options={accountPriority === 'mixed'
                                        ? [{ label: '混合优先级', value: 'mixed', disabled: true }, ...PRIORITY_OPTIONS]
                                        : PRIORITY_OPTIONS.some((option) => option.value === accountPriority)
                                          ? PRIORITY_OPTIONS
                                          : [{ label: `自定义（${accountPriority}）`, value: accountPriority }, ...PRIORITY_OPTIONS]}
                                      disabled={Boolean(updatingNode)}
                                      loading={updatingNode === `account:${source.platform_account_id}`}
                                      onChange={(value) =>
                                        void handleNodePolicy(
                                          `account:${source.platform_account_id}`,
                                          { scope: 'account', platform_account_id: source.platform_account_id },
                                          { priority: Number(value) },
                                          `账号 ${accountLabel(source)}：`
                                        )
                                      }
                                    />
                                  </span>
                                </summary>

                                <div className="ml-5 space-y-2 border-l py-2 pl-5" style={{ borderColor: 'var(--td-component-border)' }}>
                                  {accountGroups.map((group) => {
                                    const directMatch = Boolean(
                                      normalizedKeyword &&
                                        (group.name.toLocaleLowerCase().includes(normalizedKeyword) ||
                                          group.platform_group_id.toLocaleLowerCase().includes(normalizedKeyword))
                                    );
                                    const groupConnected = isAccountConnected(dashboard, group);
                                    const groupMode = processingMode(group);
                                    const priorityPreset = PRIORITY_OPTIONS.some((option) => option.value === group.priority);
                                    return (
                                      <details
                                        id={`group-tree-${group.id}`}
                                        key={`${group.id}:${directMatch}`}
                                        open={directMatch}
                                        className="rounded-lg border"
                                        style={{
                                          borderColor: directMatch
                                            ? 'var(--td-brand-color)'
                                            : 'var(--td-component-border)',
                                          background: directMatch ? 'var(--td-brand-color-light)' : 'transparent',
                                        }}
                                      >
                                        <summary className="cursor-pointer px-3 py-2.5">
                                          <span className="ml-2 text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                                            {group.name}
                                          </span>
                                          <span className="ml-3 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                                            群号 {group.platform_group_id} · {group.member_count} 人 · {group.message_count} 条消息 · {formatRelative(group.updated_at)}
                                          </span>
                                          <Tag
                                            className="ml-2"
                                            size="small"
                                            theme={groupMode === 'push' ? 'success' : groupMode === 'summary' ? 'primary' : groupMode === 'off' ? 'warning' : 'default'}
                                            variant="light"
                                          >
                                            {modeLabel(groupMode)}
                                          </Tag>
                                          {group.enabled === 1 && (
                                            <Tag className="ml-2" size="small" theme={groupConnected ? 'success' : 'default'} variant="outline">
                                              {groupConnected ? '监控中' : '等待账号连接'}
                                            </Tag>
                                          )}
                                          <Tag className="ml-2" size="small" variant="outline">优先级 {group.priority}</Tag>
                                        </summary>

                                        <div className="border-t p-3" style={{ borderColor: 'var(--td-component-border)', background: 'var(--td-bg-color-container)' }}>
                                          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                            <div className="rounded border px-3 py-2" style={{ borderColor: 'var(--td-component-border)' }}>
                                              <div className="flex items-center justify-between gap-3">
                                                <div>
                                                  <div className="text-sm" style={{ color: 'var(--td-text-color-primary)' }}>处理模式</div>
                                                  <div className="mt-0.5 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                                                    读取 → 总结 → 推送，自动保证依赖关系
                                                  </div>
                                                </div>
                                                <Select
                                                  value={groupMode}
                                                  style={{ width: 150 }}
                                                  options={PROCESSING_MODE_OPTIONS}
                                                  onChange={(value) =>
                                                    void guard(
                                                      () => updateConfig(group.id, { processing_mode: value as GroupProcessingMode }),
                                                      `处理模式已设为“${modeLabel(value as GroupProcessingMode)}”`
                                                    )
                                                  }
                                                />
                                              </div>
                                            </div>
                                            <div className="rounded border px-3 py-2" style={{ borderColor: 'var(--td-component-border)' }}>
                                              <div className="flex items-center justify-between gap-3">
                                                <div>
                                                  <div className="text-sm" style={{ color: 'var(--td-text-color-primary)' }}>重要程度</div>
                                                  <div className="mt-0.5 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                                                    选择常用档位，或输入 0～999 精确值
                                                  </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                  <Select
                                                    value={priorityPreset ? group.priority : 'custom'}
                                                    style={{ width: 125 }}
                                                    options={[
                                                      ...PRIORITY_OPTIONS,
                                                      { label: '自定义', value: 'custom', disabled: true },
                                                    ]}
                                                    onChange={(value) =>
                                                      void guard(() => updateConfig(group.id, { priority: Number(value) }))
                                                    }
                                                  />
                                                  <InputNumber
                                                    value={group.priority}
                                                    min={0}
                                                    max={999}
                                                    theme="column"
                                                    style={{ width: 92 }}
                                                    onChange={(value) =>
                                                      void guard(() => updateConfig(group.id, { priority: Number(value ?? 0) }))
                                                    }
                                                  />
                                                </div>
                                              </div>
                                            </div>
                                          </div>

                                          <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3" style={{ borderColor: 'var(--td-component-border)' }}>
                                            <Tag size="small" variant="outline">
                                              模式：{policySourceLabel(group.mode_source)}
                                            </Tag>
                                            <Tag size="small" variant="outline">
                                              优先级：{policySourceLabel(group.priority_source)}
                                            </Tag>
                                            {(group.mode_source === 'group' || group.priority_source === 'group') && (
                                              <Button
                                                size="small"
                                                variant="text"
                                                onClick={() =>
                                                  void guard(
                                                    () => inheritPolicy(group.id),
                                                    '已恢复账号、平台或全局默认策略'
                                                  )
                                                }
                                              >
                                                恢复继承
                                              </Button>
                                            )}
                                            <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                                              授权开始：{formatDateTime(group.authorized_at)}
                                            </span>
                                            {group.platform === 'qq' && (
                                              <Button
                                                className="ml-auto"
                                                size="small"
                                                variant="outline"
                                                disabled={group.enabled !== 1 || !groupConnected}
                                                title={
                                                  !groupConnected
                                                    ? `请连接账号 ${accountLabel(group)} 对应的 NapCat`
                                                    : undefined
                                                }
                                                loading={backfillingGroupId === group.id}
                                                onClick={() => void handleBackfill(group)}
                                              >
                                                回填最近 {historyCount} 条
                                              </Button>
                                            )}
                                          </div>
                                        </div>
                                      </details>
                                    );
                                  })}
                                </div>
                              </details>
                            );
                          })}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </div>
            )}
          </Loading>
        </div>
      </Card>
    </div>
  );
}
