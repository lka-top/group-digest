import { useEffect, useState } from 'react';
import { Button, Input, InputNumber, Select, Switch, Tag, MessagePlugin, Loading } from 'tdesign-react';
import { RefreshIcon } from 'tdesign-icons-react';
import { useSettings } from '../hooks/useSettings';

/**
 * 平台接入设置（适配器 / OneBot 11 / SMTP 邮件）
 */
export function PlatformSettings() {
  const { settings, loading, refresh, save, testEmail, testAi } = useSettings();
  const [ai, setAi] = useState({
    provider: 'codebuddy' as 'codebuddy' | 'openai-compatible' | 'ollama',
    baseUrl: '',
    model: 'balanced-model',
    apiKey: '',
  });
  const [onebot, setOnebot] = useState({
    mode: 'reverse-ws',
    wsPort: 3001,
    wsPath: '/onebot/v11/ws',
    napcatWsUrl: '',
    httpBaseUrl: '',
    token: '',
  });
  const [smtp, setSmtp] = useState({
    host: '',
    port: 465,
    secure: true,
    user: '',
    pass: '',
    from: '',
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingAi, setTestingAi] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setAi({
      provider: settings.ai.provider,
      baseUrl: settings.ai.baseUrl,
      model: settings.ai.model,
      apiKey: '',
    });
    setOnebot({
      mode: settings.onebot.mode,
      wsPort: settings.onebot.wsPort,
      wsPath: settings.onebot.wsPath,
      napcatWsUrl: settings.onebot.napcatWsUrl,
      httpBaseUrl: settings.onebot.httpBaseUrl,
      token: '',
    });
    setSmtp({
      host: settings.smtp.host,
      port: settings.smtp.port,
      secure: settings.smtp.secure,
      user: settings.smtp.user,
      pass: '',
      from: settings.smtp.from,
    });
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        adapter: 'onebot11',
        ai: { ...ai },
        onebot: { ...onebot },
        smtp: { ...smtp },
      };
      if (!ai.apiKey) delete (payload.ai as Record<string, unknown>).apiKey;
      if (!onebot.token) delete (payload.onebot as Record<string, unknown>).token;
      if (!smtp.pass) delete (payload.smtp as Record<string, unknown>).pass;
      const res = await save(payload);
      MessagePlugin.success(res.note || '已保存');
    } catch (err) {
      MessagePlugin.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTestAi = async () => {
    setTestingAi(true);
    try {
      const res = await testAi(ai);
      if (res.ok) MessagePlugin.success(res.detail || 'AI 连接正常');
      else MessagePlugin.error(res.detail || 'AI 连接失败');
    } catch (err) {
      MessagePlugin.error(err instanceof Error ? err.message : 'AI 连接失败');
    } finally {
      setTestingAi(false);
    }
  };

  const generateToken = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const token = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    setOnebot({ ...onebot, token });
  };

  const handleTestEmail = async () => {
    setTesting(true);
    try {
      const res = await testEmail(smtp.host ? smtp : undefined);
      if (res.ok) MessagePlugin.success('SMTP 连接正常');
      else MessagePlugin.error(res.detail || 'SMTP 连接失败');
    } finally {
      setTesting(false);
    }
  };

  if (!settings) {
    return (
      <div className="flex items-center gap-2">
        <Loading size="small" />
        <span style={{ color: 'var(--td-text-color-secondary)' }}>正在加载平台配置…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 运行时状态 */}
      <div className="flex flex-wrap items-center gap-3">
        <Tag variant="outline">适配器：{settings.runtime.adapter}</Tag>
        <Tag
          variant="light"
          theme={
            settings.runtime.adapterStatus === 'connected'
              ? 'success'
              : settings.runtime.adapterStatus === 'error'
                ? 'danger'
                : 'warning'
          }
        >
          状态：{settings.runtime.adapterStatus}
        </Tag>
        <Tag variant="outline">在线账号：{settings.runtime.adapterAccounts.length}</Tag>
        <Tag variant="light" theme={settings.runtime.aiConfigured ? 'success' : 'warning'}>
          {settings.runtime.aiConfigured ? `AI 已配置（${settings.runtime.aiProvider}）` : 'AI 凭据未配置'}
        </Tag>
        <Tag variant="outline">时区：{settings.runtime.timezone}</Tag>
        <Button variant="text" size="small" icon={<RefreshIcon />} onClick={() => void refresh()} loading={loading}>
          刷新
        </Button>
      </div>

      {/* AI 总结提供方 */}
      <div>
        <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--td-text-color-primary)' }}>
          AI 总结提供方
        </h3>
        <p className="text-xs mb-3" style={{ color: 'var(--td-text-color-placeholder)' }}>
          支持 CodeBuddy、任意 OpenAI Chat Completions 兼容接口，以及本机 Ollama。配置保存后立即生效。
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>提供方</div>
              <Select
                value={ai.provider}
                options={[
                  { label: 'CodeBuddy Agent SDK', value: 'codebuddy' },
                  { label: 'OpenAI 兼容接口', value: 'openai-compatible' },
                  { label: '本机 Ollama', value: 'ollama' },
                ]}
                onChange={(value) => {
                  const provider = value as typeof ai.provider;
                  setAi({
                    ...ai,
                    provider,
                    baseUrl: provider === 'ollama' && !ai.baseUrl ? 'http://127.0.0.1:11434/v1' : ai.baseUrl,
                    model: provider === 'ollama' && (ai.model === 'default-model' || ai.model === 'balanced-model') ? 'qwen3:8b' : ai.model,
                  });
                }}
              />
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>模型名</div>
              <Input
                value={ai.model}
                placeholder={ai.provider === 'ollama' ? 'qwen3:8b' : 'deepseek-chat'}
                onChange={(value) => setAi({ ...ai, model: value as string })}
              />
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>API Key</div>
              <Input
                type="password"
                disabled={ai.provider !== 'openai-compatible'}
                value={ai.apiKey}
                placeholder={settings.ai.apiKeySet ? `已设置（${settings.ai.apiKey}）` : ai.provider === 'ollama' ? '本机 Ollama 无需填写' : '未设置'}
                onChange={(value) => setAi({ ...ai, apiKey: value as string })}
              />
            </div>
          </div>
          {ai.provider !== 'codebuddy' && (
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>接口基地址</div>
              <Input
                value={ai.baseUrl}
                placeholder="https://api.example.com/v1"
                onChange={(value) => setAi({ ...ai, baseUrl: value as string })}
              />
            </div>
          )}
          {ai.provider === 'codebuddy' && (
            <div className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
              CodeBuddy 凭据仍通过本机 .env 或 CLI 登录提供；如果没有 CodeBuddy 账号，请选择 OpenAI 兼容接口。
            </div>
          )}
          <Button size="small" variant="outline" onClick={handleTestAi} loading={testingAi}>
            测试 AI 连接
          </Button>
        </div>
      </div>

      <div style={{ height: '1px', backgroundColor: 'var(--td-component-border)' }} />

      {/* OneBot 11 / QQ 接入 */}
      <div>
        <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--td-text-color-primary)' }}>
          QQ 接入（OneBot 11 / NapCat）
        </h3>
        <p className="text-xs mb-3" style={{ color: 'var(--td-text-color-placeholder)' }}>
          修改后需重启后端服务生效。每个 QQ 账号分别运行一个 NapCat，并在各自「网络配置」中新增 WebSocket 客户端；所有账号都可连接同一个地址
          <code className="mx-1">ws://&lt;本机IP&gt;:{onebot.wsPort}{onebot.wsPath}</code>
          并填写相同的 access token，系统会按 QQ 号自动拆分连接与数据。
        </p>
        <div className="space-y-3">
          <div>
            <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
              消息来源
            </div>
            <Tag variant="light" theme="primary">QQ（OneBot 11 / NapCat）</Tag>
            <span className="text-xs ml-3" style={{ color: 'var(--td-text-color-placeholder)' }}>
              当前仅实现反向 WebSocket；配置变更后需重启服务。
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                反向 WS 端口
              </div>
              <InputNumber
                value={onebot.wsPort}
                min={1}
                max={65535}
                onChange={(v) => setOnebot({ ...onebot, wsPort: Number(v ?? 3001) })}
              />
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                WS 路径
              </div>
              <Input value={onebot.wsPath} onChange={(v) => setOnebot({ ...onebot, wsPath: v as string })} />
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                鉴权 Token
              </div>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={onebot.token}
                  placeholder={settings.onebot.tokenSet ? `已设置（${settings.onebot.token}）` : '未设置'}
                  onChange={(v) => setOnebot({ ...onebot, token: v as string })}
                />
                <Button variant="outline" onClick={generateToken}>生成</Button>
              </div>
            </div>
          </div>
          <div className="text-xs p-2 rounded" style={{ backgroundColor: 'var(--td-warning-color-1)', color: 'var(--td-warning-color-8)' }}>
            ⚠️ 使用 NapCat 等第三方协议实现接入个人 QQ 号存在账号风控风险，请使用专用小号，并仅接入你有权管理的群聊。
          </div>
          {settings.runtime.adapterAccounts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>当前在线：</span>
              {settings.runtime.adapterAccounts.map((account) => (
                <Tag key={account.selfId} theme="success" variant="light">
                  {account.displayName ? `${account.displayName}（${account.selfId}）` : account.selfId}
                </Tag>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ height: '1px', backgroundColor: 'var(--td-component-border)' }} />

      {/* SMTP */}
      <div>
        <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--td-text-color-primary)' }}>
          邮件推送（SMTP）
        </h3>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                SMTP 服务器
              </div>
              <Input
                value={smtp.host}
                placeholder="smtp.example.com"
                onChange={(v) => setSmtp({ ...smtp, host: v as string })}
              />
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                端口
              </div>
              <InputNumber
                value={smtp.port}
                min={1}
                max={65535}
                onChange={(v) => setSmtp({ ...smtp, port: Number(v ?? 465) })}
              />
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                使用 SSL/TLS
              </div>
              <Switch value={smtp.secure} onChange={(v) => setSmtp({ ...smtp, secure: v as boolean })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                用户名
              </div>
              <Input value={smtp.user} onChange={(v) => setSmtp({ ...smtp, user: v as string })} />
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                密码 / 授权码
              </div>
              <Input
                type="password"
                value={smtp.pass}
                placeholder={settings.smtp.passSet ? '已设置' : '未设置'}
                onChange={(v) => setSmtp({ ...smtp, pass: v as string })}
              />
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                发件人地址
              </div>
              <Input
                value={smtp.from}
                placeholder="bot@example.com"
                onChange={(v) => setSmtp({ ...smtp, from: v as string })}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="small" variant="outline" onClick={handleTestEmail} loading={testing}>
              测试连接
            </Button>
            <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
              邮件通道仅对「推送通道包含邮件」的定时计划生效
            </span>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button theme="primary" onClick={handleSave} loading={saving}>
          保存全部配置
        </Button>
      </div>
    </div>
  );
}
