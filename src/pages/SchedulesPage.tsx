import { useState } from 'react';
import {
  Button,
  Card,
  Table,
  Switch,
  Tag,
  Dialog,
  Input,
  InputNumber,
  Select,
  Checkbox,
  MessagePlugin,
  Empty,
} from 'tdesign-react';
import { AddIcon, DeleteIcon, RefreshIcon, TimeIcon } from 'tdesign-icons-react';
import type { PrimaryTableCol } from 'tdesign-react';
import { useSchedules } from '../hooks/useSchedules';
import { useGroups } from '../hooks/useGroups';
import { formatDateTime } from '../api';
import type { Schedule } from '../types';

interface SchedulesPageProps {
  refreshKey: number;
}

const CRON_PRESETS = [
  { label: '每小时整点', value: '0 * * * *' },
  { label: '每天 09:00', value: '0 9 * * *' },
  { label: '每天 09:00 与 18:00', value: '0 9,18 * * *' },
  { label: '每 30 分钟', value: '*/30 * * * *' },
  { label: '每周一 09:00', value: '0 9 * * 1' },
];

const WINDOW_PRESETS = [
  { label: '1 小时', value: 60 },
  { label: '6 小时', value: 360 },
  { label: '12 小时', value: 720 },
  { label: '24 小时', value: 1440 },
  { label: '3 天', value: 4320 },
  { label: '7 天', value: 10080 },
];

export function SchedulesPage({ refreshKey }: SchedulesPageProps) {
  const { schedules, loading, refresh, create, update, remove } = useSchedules(refreshKey);
  const { groups } = useGroups(0);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [form, setForm] = useState({
    name: '',
    group_id: '',
    cron: '0 9 * * *',
    window_minutes: 720,
    channels: ['console'] as string[],
    email_to: '',
    enabled: true,
  });

  const resetForm = () =>
    setForm({ name: '', group_id: '', cron: '0 9 * * *', window_minutes: 720, channels: ['console'], email_to: '', enabled: true });

  const handleCreate = async () => {
    if (!form.name.trim()) return MessagePlugin.warning('请填写计划名称');
    if (!form.cron.trim()) return MessagePlugin.warning('请填写 cron 表达式');
    try {
      await create({
        name: form.name.trim(),
        group_id: form.group_id || null,
        cron: form.cron.trim(),
        window_minutes: form.window_minutes,
        channels: form.channels,
        email_to: form.email_to || null,
        enabled: form.enabled,
      });
      MessagePlugin.success('计划已创建');
      setDialogVisible(false);
      resetForm();
    } catch (err) {
      MessagePlugin.error(err instanceof Error ? err.message : '创建失败');
    }
  };

  const columns: PrimaryTableCol<Schedule>[] = [
    {
      colKey: 'name',
      title: '计划名称',
      cell: ({ row }) => (
        <div>
          <div className="font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
            {row.name}
          </div>
          <div className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
            每次向前回溯 {row.window_minutes} 分钟 · {row.timezone}
          </div>
        </div>
      ),
    },
    {
      colKey: 'scope',
      title: '作用范围',
      width: 160,
      cell: ({ row }) => {
        const group = groups.find((g) => g.id === row.group_id);
        return group ? <Tag variant="outline">{group.name}</Tag> : <Tag theme="primary" variant="light">全部启用群</Tag>;
      },
    },
    {
      colKey: 'cron',
      title: 'cron 表达式',
      width: 150,
      cell: ({ row }) => <code className="text-xs">{row.cron}</code>,
    },
    {
      colKey: 'channels',
      title: '推送通道',
      width: 160,
      cell: ({ row }) => {
        let channels: string[] = [];
        try {
          channels = JSON.parse(row.channels);
        } catch {
          channels = ['console'];
        }
        return (
          <div className="flex gap-1">
            {channels.map((c) => (
              <Tag key={c} size="small" variant="outline">
                {c === 'console' ? '站内' : c === 'email' ? '邮件' : c}
              </Tag>
            ))}
          </div>
        );
      },
    },
    {
      colKey: 'last_run',
      title: '上次执行',
      width: 190,
      cell: ({ row }) => (
        <div className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
          <div>{formatDateTime(row.last_run)}</div>
          {row.last_status && (
            <Tag size="small" variant="light" theme={row.last_status === 'ok' ? 'success' : 'danger'}>
              {row.last_status}
            </Tag>
          )}
        </div>
      ),
    },
    {
      colKey: 'enabled',
      title: '启用',
      width: 90,
      cell: ({ row }) => (
        <Switch
          value={row.enabled === 1}
          onChange={(v) => void update(row.id, { enabled: v as boolean })}
        />
      ),
    },
    {
      colKey: 'op',
      title: '操作',
      width: 90,
      cell: ({ row }) => (
        <Button
          variant="text"
          theme="danger"
          size="small"
          icon={<DeleteIcon />}
          onClick={async () => {
            await remove(row.id);
            MessagePlugin.success('已删除');
          }}
        >
          删除
        </Button>
      ),
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
            定时总结
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>
            按 cron 表达式定时对群聊生成总结并按通道推送
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" icon={<RefreshIcon />} onClick={() => void refresh()} loading={loading}>
            刷新
          </Button>
          <Button
            theme="primary"
            icon={<AddIcon />}
            onClick={() => {
              resetForm();
              setDialogVisible(true);
            }}
          >
            新建计划
          </Button>
        </div>
      </div>

      <Card>
        {schedules.length === 0 ? (
          <Empty description="暂无定时计划" />
        ) : (
          <Table rowKey="id" data={schedules} columns={columns} loading={loading} size="small" />
        )}
      </Card>

      <Dialog
        visible={dialogVisible}
        header="新建定时计划"
        width={620}
        onClose={() => setDialogVisible(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogVisible(false)}>
              取消
            </Button>
            <Button theme="primary" onClick={handleCreate}>
              创建
            </Button>
          </div>
        }
      >
        <div className="space-y-4 pt-2">
          <div>
            <div className="text-sm mb-1" style={{ color: 'var(--td-text-color-secondary)' }}>
              计划名称
            </div>
            <Input value={form.name} placeholder="如：每日早报总结" onChange={(v) => setForm({ ...form, name: v as string })} />
          </div>

          <div>
            <div className="text-sm mb-1" style={{ color: 'var(--td-text-color-secondary)' }}>
              作用范围
            </div>
            <Select
              value={form.group_id}
              placeholder="全部启用群"
              clearable
              options={groups
                .filter((group) => group.enabled === 1 && group.summary_enabled === 1)
                .map((g) => ({ label: g.name, value: g.id }))}
              onChange={(v) => setForm({ ...form, group_id: (v as string) || '' })}
            />
          </div>

          <div>
            <div className="text-sm mb-1" style={{ color: 'var(--td-text-color-secondary)' }}>
              cron 表达式（分 时 日 月 周）
            </div>
            <Input value={form.cron} onChange={(v) => setForm({ ...form, cron: v as string })} />
            <div className="flex flex-wrap gap-2 mt-2">
              {CRON_PRESETS.map((p) => (
                <Tag
                  key={p.value}
                  size="small"
                  variant="outline"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setForm({ ...form, cron: p.value })}
                >
                  <TimeIcon /> {p.label}
                </Tag>
              ))}
            </div>
          </div>

          <div>
            <div className="text-sm mb-1" style={{ color: 'var(--td-text-color-secondary)' }}>
              自动总结的滚动时间窗（每次执行向前回溯）
            </div>
            <InputNumber
              value={form.window_minutes}
              min={10}
              max={525600}
              step={10}
              onChange={(v) => setForm({ ...form, window_minutes: Number(v ?? 720) })}
            />
            <div className="flex flex-wrap gap-2 mt-2">
              {WINDOW_PRESETS.map((preset) => (
                <Tag
                  key={preset.value}
                  size="small"
                  variant={form.window_minutes === preset.value ? 'light' : 'outline'}
                  theme={form.window_minutes === preset.value ? 'primary' : 'default'}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setForm({ ...form, window_minutes: preset.value })}
                >
                  {preset.label}
                </Tag>
              ))}
            </div>
            <div className="mt-2 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
              实际起点不会早于群最近一次授权开始时间；授权前历史仅供手动自定义范围总结。
            </div>
          </div>

          <div>
            <div className="text-sm mb-1" style={{ color: 'var(--td-text-color-secondary)' }}>
              推送通道
            </div>
            <Checkbox.Group
              value={form.channels}
              options={[
                { label: '站内控制台', value: 'console' },
                { label: '邮件', value: 'email' },
              ]}
              onChange={(v) => setForm({ ...form, channels: v as string[] })}
            />
          </div>

          {form.channels.includes('email') && (
            <div>
              <div className="text-sm mb-1" style={{ color: 'var(--td-text-color-secondary)' }}>
                邮件收件人
              </div>
              <Input
                value={form.email_to}
                placeholder="someone@example.com"
                onChange={(v) => setForm({ ...form, email_to: v as string })}
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <Switch value={form.enabled} onChange={(v) => setForm({ ...form, enabled: v as boolean })} />
            <span className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
              创建后立即启用
            </span>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
