import { Button, Tooltip, Badge } from 'tdesign-react';
import { AddIcon, DeleteIcon, SettingIcon } from 'tdesign-icons-react';
import { Bot, Users, MessageSquare, FileText, Bell, Clock, Flag } from 'lucide-react';
import { APP_CONFIG } from '../config';
import { Session, Agent } from '../types';
import { ICON_MAP } from '../utils/iconMap';

interface SidebarProps {
  sessions: Session[];
  currentSessionId: string | null;
  currentPath: string;
  sidebarOpen: boolean;
  agents: Agent[];
  unreadCount: number;
  getAgent: (id: string) => Agent | undefined;
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenSettings: () => void;
  onNavigate: (path: string) => void;
}

interface NavItem {
  path: string;
  label: string;
  icon: typeof Users;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/groups', label: '群聊管理', icon: Users },
  { path: '/messages', label: '群消息', icon: MessageSquare },
  { path: '/summary', label: '总结中心', icon: FileText },
  { path: '/notifications', label: '通知中心', icon: Bell },
  { path: '/schedules', label: '定时总结', icon: Clock },
  { path: '/priorities', label: '优先级规则', icon: Flag },
];

export function Sidebar({
  sessions,
  currentSessionId,
  currentPath,
  sidebarOpen,
  agents,
  unreadCount,
  getAgent,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onOpenSettings,
  onNavigate,
}: SidebarProps) {
  const isSettingsPage = currentPath === '/settings';
  const isChatPage = currentPath === '/' || currentPath.startsWith('/chat/');

  return (
    <aside 
      className="flex flex-col flex-shrink-0 transition-all duration-300 overflow-hidden"
      style={{ 
        width: sidebarOpen ? 260 : 0,
        backgroundColor: 'var(--td-bg-color-container)'
      }}
    >
      {/* Logo */}
      <div className="h-14 px-4 flex items-center flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div 
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: 'var(--td-brand-color)' }}
          >
            <span className="text-white text-sm font-bold">{APP_CONFIG.nameInitial}</span>
          </div>
          <span 
            className="text-lg font-semibold"
            style={{ color: 'var(--td-text-color-primary)' }}
          >
            {APP_CONFIG.name}
          </span>
        </div>
      </div>

      {/* 功能导航 */}
      <nav className="px-2 pb-1 space-y-0.5 flex-shrink-0">
        {NAV_ITEMS.map((item) => {
          const active = currentPath === item.path;
          const Icon = item.icon;
          return (
            <div
              key={item.path}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors duration-200"
              style={{
                backgroundColor: active ? 'var(--td-brand-color-light)' : 'transparent',
                color: active ? 'var(--td-brand-color)' : 'var(--td-text-color-secondary)',
              }}
              onClick={() => onNavigate(item.path)}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.backgroundColor = 'var(--td-bg-color-component-hover)';
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <Icon size={16} />
              <span className="flex-1 text-sm">{item.label}</span>
              {item.path === '/notifications' && unreadCount > 0 && (
                <Badge count={unreadCount} size="small" />
              )}
            </div>
          );
        })}
      </nav>

      {/* 对话区标题 + 新对话 */}
      <div
        className="px-3 pt-3 pb-2 mt-1 border-t flex items-center justify-between flex-shrink-0"
        style={{ borderColor: 'var(--td-component-border)' }}
      >
        <span
          className="text-xs font-medium tracking-wide"
          style={{ color: 'var(--td-text-color-placeholder)' }}
        >
          AGENT 对话
        </span>
        <Tooltip content="新对话">
          <Button
            variant="text"
            shape="circle"
            size="small"
            icon={<AddIcon />}
            onClick={onNewChat}
          />
        </Tooltip>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.length === 0 && (
          <div
            className="px-3 py-6 text-center text-xs"
            style={{ color: 'var(--td-text-color-placeholder)' }}
          >
            暂无对话，点击上方 + 开始
          </div>
        )}
        {sessions.map(session => {
          const sessionAgent = session.agentId ? getAgent(session.agentId) : getAgent('default');
          const AgentIcon = ICON_MAP[sessionAgent?.icon || 'Bot'] || Bot;
          const active = session.id === currentSessionId && isChatPage;
          return (
            <div 
              key={session.id}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors duration-200 group"
              style={{
                backgroundColor: active ? 'var(--td-brand-color-light)' : 'transparent',
                color: active ? 'var(--td-brand-color)' : 'var(--td-text-color-secondary)'
              }}
              onClick={() => onSelectSession(session.id)}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.backgroundColor = 'var(--td-bg-color-component-hover)';
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <div 
                className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center"
                style={{ backgroundColor: sessionAgent?.color || 'var(--td-brand-color)' }}
              >
                <AgentIcon size={12} color="white" />
              </div>
              <span className="flex-1 truncate text-sm">{session.title}</span>
              <Tooltip content="删除会话">
                <Button
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  variant="text"
                  shape="circle"
                  size="medium"
                  icon={<DeleteIcon />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(session.id);
                  }}
                />
              </Tooltip>
            </div>
          );
        })}
      </div>
      
      {/* 底部设置按钮 */}
      <div 
        className="p-3 border-t flex-shrink-0"
        style={{ borderColor: 'var(--td-component-border)' }}
      >
        <Button 
          icon={<SettingIcon />}
          onClick={onOpenSettings}
          block
          variant={isSettingsPage ? 'outline' : 'text'}
          theme={isSettingsPage ? 'primary' : 'default'}
        >
          设置
        </Button>
      </div>
    </aside>
  );
}
