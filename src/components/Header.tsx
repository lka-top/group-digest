import { Button, Tooltip, Tag } from 'tdesign-react';
import { 
  RefreshIcon,
  SunnyIcon,
  MoonIcon,
  MenuFoldIcon,
  MenuUnfoldIcon,
} from 'tdesign-icons-react';
import { Bot } from 'lucide-react';
import { APP_CONFIG } from '../config';
import { Model, Session, Agent, Theme } from '../types';
import { ICON_MAP } from '../utils/iconMap';

interface HeaderProps {
  isSettingsPage: boolean;
  sidebarOpen: boolean;
  theme: Theme;
  currentSession: Session | undefined;
  currentAgent: Agent | undefined;
  models: Model[];
  /** 非对话页面的标题（群聊/消息/总结…），提供时优先展示 */
  title?: string;
  onToggleSidebar: () => void;
  onToggleTheme: () => void;
  onRefreshModels: () => void;
}

export function Header({
  isSettingsPage,
  sidebarOpen,
  theme,
  currentSession,
  currentAgent,
  models,
  title,
  onToggleSidebar,
  onToggleTheme,
  onRefreshModels,
}: HeaderProps) {
  const isChatPage = !isSettingsPage && !title;
  const formatModelName = (modelId: string) => {
    const model = models.find(m => m.modelId === modelId);
    const name = model?.name || modelId;
    return name
      .replace(/^(Claude|GPT|Gemini|Kimi|DeepSeek|Qwen|GLM)\s*/i, '')
      .replace(/-/g, ' ')
      .trim() || name;
  };

  return (
    <header 
      className="h-14 flex justify-between items-center px-4 flex-shrink-0"
      style={{ 
        backgroundColor: 'var(--td-bg-color-page)'
      }}
    >
      <div className="flex items-center gap-3">
        <Button
          variant="text"
          shape="circle"
          icon={sidebarOpen ? <MenuFoldIcon /> : <MenuUnfoldIcon />}
          onClick={onToggleSidebar}
        />
        {isChatPage && currentAgent && (
          <div 
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: currentAgent.color || 'var(--td-brand-color)' }}
          >
            {(() => {
              const Icon = ICON_MAP[currentAgent.icon || 'Bot'] || Bot;
              return <Icon size={14} color="white" />;
            })()}
          </div>
        )}
        <h1 
          className="text-base font-semibold"
          style={{ color: 'var(--td-text-color-primary)' }}
        >
          {title || (isSettingsPage ? '设置' : (currentSession?.title || APP_CONFIG.name))}
        </h1>
        {isChatPage && currentSession && (
          <Tag size="small" variant="outline">
            {formatModelName(currentSession.model)}
          </Tag>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Tooltip content={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}>
          <Button
            variant="outline"
            shape="circle"
            icon={theme === 'light' ? <MoonIcon /> : <SunnyIcon />}
            onClick={onToggleTheme}
          />
        </Tooltip>
        {!isSettingsPage && (
          <Tooltip content="刷新模型列表">
            <Button
              variant="outline"
              shape="circle"
              icon={<RefreshIcon />}
              onClick={onRefreshModels}
            />
          </Tooltip>
        )}
      </div>
    </header>
  );
}
