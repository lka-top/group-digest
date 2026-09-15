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
  Radio,
  MessagePlugin,
  Empty,
} from 'tdesign-react';
import { AddIcon, DeleteIcon, RefreshIcon } from 'tdesign-icons-react';
import type { PrimaryTableCol } from 'tdesign-react';
import { usePriorities } from '../hooks/usePriorities';
import { useGroups } from '../hooks/useGroups';
import type { PriorityRule } from '../types';

interface PrioritiesPageProps {
  refreshKey: number;
}

const MATCH_LABEL: Record<string, string> = {
  keyword: '关键词包含',
  sender: '发送者匹配',
  regex: '正则表达式',
};

export function PrioritiesPage({ refreshKey }: PrioritiesPageProps) {
  const { rules, loading, refresh, create, update, remove } = usePriorities(refreshKey);
  const { groups } = useGroups(0);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [form, setForm] = useState({
    name: '',
    scope_type: 'global' as 'global' | 'group',
    group_id: '',
    match_type: 'keyword' as 'keyword' | 'sender' | 'regex',
    pattern: '',
    priority: 100,
    action: 'instant_notify' as 'instant_notify' | 'boost_summary',
    enabled: true,
  });

  const resetForm = () =>
    setForm({
      name: '',
      scope_type: 'global',
      group_id: '',
      match_type: 'keyword',
      pattern: '',
      priority: 100,
      action: 'instant_notify',
      enabled: true,
    });

  const handleCreate = async () => {
    if (!form.name.trim()) return MessagePlugin.warning('请填写规则名称');
    if (!form.pattern.trim()) return MessagePlugin.warning('请填写匹配内容');
    if (form.scope_type === 'group' && !form.group_id) return MessagePlugin.warning('请选择作用群');
    if (form.match_type === 'regex') {
      try {
        new RegExp(form.pattern);
      } catch {
        return MessagePlugin.error('正则表达式不合法');
      }
    }
    try {
      await create({
        name: form.name.trim(),
        scope_type: form.scope_type,
        group_id: form.scope_type === 'group' ? form.group_id : null,
        match_type: form.match_type,
        pattern: form.pattern,
        priority: form.priority,
        action: form.action,
        enabled: form.enabled,
      });
      MessagePlugin.success('规则已创建');
      setDialogVisible(false);
      resetForm();
    } catch (err) {
      MessagePlugin.error(err instanceof Error ? err.message : '创建失败');
    }
  };

  const columns: PrimaryTableCol<PriorityRule>[] = [
    {
      colKey: 'name',
      title: '规则名称',
      cell: ({ row }) => <span className="font-medium">{row.name}</span>,
    },
    {
      colKey: 'scope',
      title: '作用范围',
      width: 150,
      cell: ({ row }) => {
        const group = groups.find((g) => g.id === row.group_id);
        return group ? <Tag variant="outline">{group.name}</Tag> : <Tag theme="primary" variant="light">全局</Tag>;
      },
    },
    {
      colKey: 'match',
      title: '匹配方式',
      width: 160,
      cell: ({ row }) => (
        <div className="text-xs">
          <div style={{ color: 'var(--td-text-color-primary)' }}>{MATCH_LABEL[row.match_type] || row.match_type}</div>
          <code style={{ color: 'var(--td-text-color-placeholder)' }}>{row.pattern}</code>
        </div>
      ),
    },
    {
      colKey: 'priority',
      title: '优先级',
      width: 90,
      cell: ({ row }) => <Tag variant="light">{row.priority}</Tag>,
    },
    {
      colKey: 'action',
      title: '命中动作',
      width: 140,
      cell: ({ row }) => (
        <Tag size="small" theme={row.action === 'instant_notify' ? 'danger' : 'primary'} variant="light">
          {row.action === 'instant_notify' ? '即时提醒' : '提升总结权重'}
        </Tag>
      ),
    },
    {
      colKey: 'enabled',
      title: '启用',
      width: 90,
      cell: ({ row }) => (
        <Switch value={row.enabled === 1} onChange={(v) => void update(row.id, { enabled: v as boolean })} />
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
            优先级规则
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>
            命中规则的消息会触发站内即时提醒（带冷却与限流，避免刷屏）
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
            新建规则
          </Button>
        </div>
      </div>

      <Card>
        {rules.length === 0 ? (
          <Empty description="暂无优先级规则" />
        ) : (
          <Table rowKey="id" data={rules} columns={columns} loading={loading} size="small" />
        )}
      </Card>

      <Dialog
        visible={dialogVisible}
        header="新建优先级规则"
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
              规则名称
            </div>
            <Input
              value={form.name}
              placeholder="如：线上故障关键词"
              onChange={(v) => setForm({ ...form, name: v as string })}
            />
          </div>

          <div>
            <div className="text-sm mb-1" style={{ color: 'var(--td-text-color-secondary)' }}>
              作用范围
            </div>
            <Radio.Group
              value={form.scope_type}
              onChange={(v) => setForm({ ...form, scope_type: v as 'global' | 'group' })}
            >
              <Radio.Button value="global">全部群</Radio.Button>
              <Radio.Button value="group">指定群</Radio.Button>
            </Radio.Group>
            {form.scope_type === 'group' && (
              <Select
                className="mt-2"
                value={form.group_id}
                placeholder="选择群"
                options={groups.map((g) => ({ label: g.name, value: g.id }))}
                onChange={(v) => setForm({ ...form, group_id: (v as string) || '' })}
              />
            )}
          </div>

          <div>
            <div className="text-sm mb-1" style={{ color: 'var(--td-text-color-secondary)' }}>
              匹配方式
            </div>
            <Radio.Group
              value={form.match_type}
              onChange={(v) =>
                setForm({ ...form, match_type: v as 'keyword' | 'sender' | 'regex' })
              }
            >
              <Radio.Button value="keyword">关键词包含</Radio.Button>
              <Radio.Button value="sender">发送者匹配</Radio.Button>
              <Radio.Button value="regex">正则表达式</Radio.Button>
            </Radio.Group>
          </div>

          <div>
            <div className="text-sm mb-1" style={{ color: 'var(--td-text-color-secondary)' }}>
              匹配内容
            </div>
            <Input
              value={form.pattern}
              placeholder={form.match_type === 'regex' ? '(紧急|故障|报警)' : '如：紧急'}
              onChange={(v) => setForm({ ...form, pattern: v as string })}
            />
          </div>

          <div className="flex items-center gap-6">
            <div>
              <div className="text-sm mb-1" style={{ color: 'var(--td-text-color-secondary)' }}>
                优先级
              </div>
              <InputNumber
                value={form.priority}
                min={1}
                max={999}
                onChange={(v) => setForm({ ...form, priority: Number(v ?? 100) })}
              />
            </div>
            <div>
              <div className="text-sm mb-1" style={{ color: 'var(--td-text-color-secondary)' }}>
                命中动作
              </div>
              <Select
                value={form.action}
                style={{ width: 200 }}
                options={[
                  { label: '即时提醒', value: 'instant_notify' },
                  { label: '提升总结权重', value: 'boost_summary' },
                ]}
                onChange={(v) => setForm({ ...form, action: v as 'instant_notify' | 'boost_summary' })}
              />
            </div>
          </div>

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
