import { useCallback, useMemo, useRef, useState } from 'react';
import { Button, Card, Select, Radio, Switch, Loading, Empty, Tag, MessagePlugin, Alert } from 'tdesign-react';
import { RefreshIcon, FileIcon } from 'tdesign-icons-react';
import { useGroups } from '../hooks/useGroups';
import { useSummaries } from '../hooks/useSummaries';
import { formatDateTime } from '../api';
import { accountLabel, groupLabel, platformLabel } from '../utils/sourceLabel';
import type { DashboardData, Group, Summary } from '../types';

interface SummaryPageProps {
  refreshKey: number;
  aiConfigured: boolean;
  dashboard?: DashboardData;
  onNavigateSettings: () => void;
}

const WINDOW_OPTIONS = [
  { label: '最近 1 小时', value: 60 },
  { label: '最近 6 小时', value: 360 },
  { label: '最近 12 小时', value: 720 },
  { label: '最近 24 小时', value: 1440 },
  { label: '最近 7 天', value: 10080 },
];

function toLocalDateTimeValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function SummaryPage({ refreshKey, aiConfigured, dashboard, onNavigateSettings }: SummaryPageProps) {
  const { groups } = useGroups(0);
  const { summaries, loading, generating, refresh, generate } = useSummaries(refreshKey);

  const [platform, setPlatform] = useState('');
  const [platformAccountId, setPlatformAccountId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [rangeMode, setRangeMode] = useState<'relative' | 'custom'>('relative');
  const [windowMinutes, setWindowMinutes] = useState(720);
  const [allowRelativeBackfill, setAllowRelativeBackfill] = useState(true);
  const [customStart, setCustomStart] = useState(() => toLocalDateTimeValue(new Date(Date.now() - 12 * 60 * 60_000)));
  const [customEnd, setCustomEnd] = useState(() => toLocalDateTimeValue(new Date()));
  const [liveText, setLiveText] = useState('');
  const [selected, setSelected] = useState<Summary | null>(null);
  const liveRef = useRef<string>('');

  const selectableGroups = useMemo(
    () => groups.filter((group) => group.enabled === 1 && group.summary_enabled === 1),
    [groups]
  );
  const platformOptions = useMemo(
    () => Array.from(new Set(selectableGroups.map((group) => group.platform))).sort(),
    [selectableGroups]
  );
  const accountOptions = useMemo(() => {
    const unique = new Map<string, Group>();
    selectableGroups.forEach((group) => {
      if ((!platform || group.platform === platform) && !unique.has(group.platform_account_id)) {
        unique.set(group.platform_account_id, group);
      }
    });
    return Array.from(unique.values());
  }, [platform, selectableGroups]);
  const filteredSelectableGroups = useMemo(
    () =>
      selectableGroups.filter(
        (group) =>
          (!platform || group.platform === platform) &&
          (!platformAccountId || group.platform_account_id === platformAccountId)
      ),
    [platform, platformAccountId, selectableGroups]
  );

  const handleGenerate = useCallback(async () => {
    if (!groupId) {
      MessagePlugin.warning('请先选择要总结的群');
      return;
    }
    let explicitWindow: { start: string; end: string } | undefined;
    if (rangeMode === 'custom') {
      const startDate = new Date(customStart);
      const endDate = new Date(customEnd);
      if (!customStart || !customEnd || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        MessagePlugin.warning('请选择有效的开始和结束时间');
        return;
      }
      if (startDate.getTime() >= endDate.getTime()) {
        MessagePlugin.warning('开始时间必须早于结束时间');
        return;
      }
      explicitWindow = { start: startDate.toISOString(), end: endDate.toISOString() };
    }
    liveRef.current = '';
    setLiveText('');
    await generate({
      groupId,
      windowMinutes: rangeMode === 'relative' ? windowMinutes : undefined,
      start: explicitWindow?.start,
      end: explicitWindow?.end,
      allowBackfill: rangeMode === 'relative' && allowRelativeBackfill,
      onProgress: (chunk) => {
        liveRef.current += chunk;
        setLiveText(liveRef.current);
      },
      onDone: (result) => {
        if (result.status === 'done') {
          MessagePlugin.success('总结已生成');
        } else {
          MessagePlugin.error(result.error || '总结生成失败');
        }
        void refresh();
      },
      onError: (msg) => MessagePlugin.error(msg),
    });
  }, [allowRelativeBackfill, customEnd, customStart, groupId, rangeMode, windowMinutes, generate, refresh]);

  const selectedGroup = selectableGroups.find((group) => group.id === groupId);
  const requestedStartMs =
    rangeMode === 'relative' ? Date.now() - windowMinutes * 60_000 : new Date(customStart).getTime();
  const startsBeforeAuthorization =
    Boolean(selectedGroup?.authorized_at) &&
    !Number.isNaN(requestedStartMs) &&
    requestedStartMs < Date.parse(selectedGroup!.authorized_at!);
  const needsHistoricalBackfill =
    startsBeforeAuthorization && (rangeMode === 'custom' || allowRelativeBackfill);
  const selectedAccountIsCurrent =
    Boolean(selectedGroup) &&
    dashboard?.adapter.platform === selectedGroup?.platform &&
    dashboard?.adapter.accounts.some(
      (account) => account.selfId === selectedGroup?.account_self_id && account.status === 'connected'
    );

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
            总结中心
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>
            按平台、登录账号和群聊选择消息源，在指定时间窗内生成并查看 AI 总结
          </p>
        </div>
        <Button variant="outline" icon={<RefreshIcon />} onClick={() => void refresh()} loading={loading}>
          刷新
        </Button>
      </div>

      {!aiConfigured && (
        <Alert
          className="mb-4"
          theme="warning"
          title="尚未配置 AI 提供方，AI 总结将无法生成"
          message={
            <span>
              请在 <a onClick={onNavigateSettings} style={{ color: 'var(--td-brand-color)', cursor: 'pointer' }}>设置</a>{' '}
              页选择 CodeBuddy、OpenAI 兼容接口或本机 Ollama，并填写对应配置。
            </span>
          }
        />
      )}

      <Card className="mb-4" title="手动一键总结">
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Select
            value={platform}
            placeholder="选择平台"
            clearable
            style={{ width: 150 }}
            options={platformOptions.map((value) => ({ label: platformLabel(value), value }))}
            onChange={(value) => {
              setPlatform((value as string) || '');
              setPlatformAccountId('');
              setGroupId('');
            }}
          />
          <Select
            value={platformAccountId}
            placeholder="选择登录账号"
            clearable
            style={{ width: 240 }}
            options={accountOptions.map((group) => ({
              label: `${platformLabel(group.platform)} · ${accountLabel(group)}`,
              value: group.platform_account_id,
            }))}
            onChange={(value) => {
              setPlatformAccountId((value as string) || '');
              setGroupId('');
            }}
          />
          <Select
            value={groupId}
            placeholder="选择群聊"
            style={{ width: 300 }}
            options={filteredSelectableGroups.map((group) => ({
              label: `${groupLabel(group)} · ${group.message_count} 条`,
              value: group.id,
            }))}
            onChange={(v) => setGroupId((v as string) || '')}
          />
          <Radio.Group
            variant="default-filled"
            value={rangeMode}
            onChange={(v) => setRangeMode(v as 'relative' | 'custom')}
          >
            <Radio.Button value="relative">滚动时间窗</Radio.Button>
            <Radio.Button value="custom">自定义起止</Radio.Button>
          </Radio.Group>
          {rangeMode === 'relative' ? (
            <div className="flex flex-wrap items-center gap-3">
              <Radio.Group
                variant="default-filled"
                value={windowMinutes}
                onChange={(v) => setWindowMinutes(Number(v))}
              >
                {WINDOW_OPTIONS.map((o) => (
                  <Radio.Button key={o.value} value={o.value}>
                    {o.label}
                  </Radio.Button>
                ))}
              </Radio.Group>
              <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
                <Switch
                  size="small"
                  value={allowRelativeBackfill}
                  onChange={(value) => setAllowRelativeBackfill(Boolean(value))}
                />
                允许回填授权前消息
              </label>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
                开始
              </label>
              <input
                type="datetime-local"
                value={customStart}
                onChange={(event) => setCustomStart(event.target.value)}
                className="rounded border px-2 py-1.5 text-sm"
                style={{ borderColor: 'var(--td-component-border)', background: 'var(--td-bg-color-container)' }}
              />
              <label className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
                结束
              </label>
              <input
                type="datetime-local"
                value={customEnd}
                onChange={(event) => setCustomEnd(event.target.value)}
                className="rounded border px-2 py-1.5 text-sm"
                style={{ borderColor: 'var(--td-component-border)', background: 'var(--td-bg-color-container)' }}
              />
            </div>
          )}
          <Button
            theme="primary"
            icon={<FileIcon />}
            loading={generating}
            disabled={needsHistoricalBackfill && !selectedAccountIsCurrent}
            onClick={handleGenerate}
          >
            {generating ? '处理中…' : needsHistoricalBackfill ? '回填并生成总结' : '生成总结'}
          </Button>
        </div>
        {needsHistoricalBackfill && (
          <Alert
            className="mt-3"
            theme={selectedAccountIsCurrent ? 'info' : 'warning'}
            title={selectedAccountIsCurrent ? '将自动回填历史消息' : '该群所属账号尚未连接'}
            message={
              selectedAccountIsCurrent
                ? '所选开始时间早于该群授权监控时间。点击后会先从当前平台账号向前读取到开始时间，再生成总结；进度会显示在下方。'
                : `该群属于 ${platformLabel(selectedGroup?.platform)} 账号 ${accountLabel(selectedGroup ?? {})}。请让该账号对应的 NapCat 同时连接到本服务后再回填。`
            }
          />
        )}
        <div className="mt-3 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
          滚动时间窗默认允许回填完整的最近范围；关闭回填许可后将从群授权时间截断。自定义起止仍视为本次明确许可。
        </div>

        {(liveText || generating) && (
          <div
            className="mt-4 p-4 rounded-lg text-sm whitespace-pre-wrap break-words max-h-96 overflow-y-auto"
            style={{ backgroundColor: 'var(--td-bg-color-secondarycontainer)', color: 'var(--td-text-color-primary)' }}
          >
            {liveText || '正在生成…'}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <Card className="xl:col-span-2" title={`历史总结（${summaries.length}）`}>
          <Loading loading={loading}>
            {summaries.length === 0 ? (
              <Empty description="暂无总结" />
            ) : (
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {summaries.map((s) => (
                  <div
                    key={s.id}
                    className="p-3 rounded-lg cursor-pointer border transition-colors"
                    style={{
                      borderColor: selected?.id === s.id ? 'var(--td-brand-color)' : 'var(--td-component-border)',
                      backgroundColor:
                        selected?.id === s.id ? 'var(--td-brand-color-light)' : 'transparent',
                    }}
                    onClick={() => setSelected(s)}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Tag size="small" theme="primary" variant="light">{platformLabel(s.platform)}</Tag>
                      <Tag size="small" variant="outline">账号 {accountLabel(s)}</Tag>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--td-text-color-primary)' }}>
                        {groupLabel(s)}
                      </span>
                      <Tag size="small" variant="outline" theme={s.trigger_type === 'manual' ? 'primary' : 'success'}>
                        {s.trigger_type === 'manual' ? '手动' : s.trigger_type === 'schedule' ? '定时' : '即时'}
                      </Tag>
                      {s.status !== 'done' && (
                        <Tag size="small" theme="danger" variant="light">
                          {s.status === 'failed' ? '失败' : '生成中'}
                        </Tag>
                      )}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                      {formatDateTime(s.window_start)} ~ {formatDateTime(s.window_end)}
                    </div>
                    <div className="text-xs mt-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                      生成于 {formatDateTime(s.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Loading>
        </Card>

        <Card className="xl:col-span-3" title="总结详情">
          {!selected ? (
            <Empty description="从左侧选择一条总结查看详情" />
          ) : (
            <div className="max-h-[560px] overflow-y-auto">
              <div className="mb-4 flex flex-wrap items-center gap-2 border-b pb-3" style={{ borderColor: 'var(--td-component-border)' }}>
                <Tag theme="primary" variant="light">{platformLabel(selected.platform)}</Tag>
                <Tag variant="outline">登录账号 {accountLabel(selected)}</Tag>
                <Tag variant="outline">群聊 {groupLabel(selected)}</Tag>
                <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                  {formatDateTime(selected.window_start)} ~ {formatDateTime(selected.window_end)}
                </span>
              </div>
              {selected.status === 'failed' ? (
                <Alert theme="error" title="生成失败" message={selected.error || '未知错误'} />
              ) : (
                <div
                  className="text-sm whitespace-pre-wrap break-words leading-relaxed"
                  style={{ color: 'var(--td-text-color-primary)' }}
                >
                  {selected.content_md}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
