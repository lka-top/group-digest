import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, useNavigate, useParams, useLocation } from 'react-router-dom';
import '@tdesign-react/chat/es/style/index.js';

import { useAgents } from './hooks/useAgents';
import { useTheme } from './hooks/useTheme';
import { useSessions } from './hooks/useSessions';
import { useModels } from './hooks/useModels';
import { useChat } from './hooks/useChat';
import { useEvents } from './hooks/useEvents';
import { useDashboard } from './hooks/useDashboard';
import { useNotifications } from './hooks/useNotifications';
import { PermissionMode } from './types';

import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { SettingsPage } from './components/SettingsPage';
import { ChatPage } from './pages/ChatPage';
import { GroupsPage } from './pages/GroupsPage';
import { MessagesPage } from './pages/MessagesPage';
import { SummaryPage } from './pages/SummaryPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { SchedulesPage } from './pages/SchedulesPage';
import { PrioritiesPage } from './pages/PrioritiesPage';

const PAGE_TITLES: Record<string, string> = {
  '/groups': '群聊管理',
  '/messages': '群消息',
  '/summary': '总结中心',
  '/notifications': '通知中心',
  '/schedules': '定时总结',
  '/priorities': '优先级规则',
};

function App() {
  return (
    <Routes>
      <Route path="/" element={<AppContent />} />
      <Route path="/chat/:sessionId" element={<AppContent />} />
      <Route path="/settings" element={<AppContent />} />
      <Route path="/groups" element={<AppContent />} />
      <Route path="/messages" element={<AppContent />} />
      <Route path="/summary" element={<AppContent />} />
      <Route path="/notifications" element={<AppContent />} />
      <Route path="/schedules" element={<AppContent />} />
      <Route path="/priorities" element={<AppContent />} />
    </Routes>
  );
}

function AppContent() {
  const navigate = useNavigate();
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const path = location.pathname;
  const isSettingsPage = path === '/settings';
  const pageTitle = PAGE_TITLES[path];
  const isChatPage = !isSettingsPage && !pageTitle;

  // 全局刷新信号：由实时事件驱动，各页面据此重新拉取数据
  const [refreshKey, setRefreshKey] = useState(0);
  const lastBumpRef = useRef(0);
  useEvents((event) => {
    const now = Date.now();
    if (event.type === 'message') {
      // 消息事件很频繁，做节流，避免请求风暴
      if (now - lastBumpRef.current > 4000) {
        lastBumpRef.current = now;
        setRefreshKey((k) => k + 1);
      }
    } else if (
      event.type === 'summary' ||
      event.type === 'instant' ||
      event.type === 'groups_synced' ||
      event.type === 'group_config' ||
      event.type === 'status'
    ) {
      lastBumpRef.current = now;
      setRefreshKey((k) => k + 1);
    }
  });

  // Hooks
  const { theme, toggleTheme } = useTheme();
  const { agents, addAgent, updateAgent, deleteAgent, getAgent } = useAgents();
  const { models, selectedModel, setSelectedModel, fetchModels } = useModels();
  const { data: dashboard } = useDashboard(refreshKey);
  const notif = useNotifications(refreshKey);
  const {
    sessions,
    setSessions,
    currentSessionId,
    setCurrentSessionId,
    currentSession,
    sessionModels,
    fetchSessions,
    deleteSession,
    updateSessionModel,
    addSession,
    updateSession,
    updateSessionMessages,
  } = useSessions();

  // 聊天 Hook
  const {
    isLoading,
    inputValue,
    setInputValue,
    permissionRequest,
    sendMessage,
    handleStop,
    handlePermissionAllow,
    handlePermissionDeny,
  } = useChat({
    currentSession,
    currentSessionId,
    selectedModel,
    getAgent,
    addSession,
    updateSession,
    updateSessionMessages,
    updateSessionModel,
    setCurrentSessionId,
    setSessions,
  });

  // 获取当前会话的 Agent
  const currentAgent = currentSession?.agentId ? getAgent(currentSession.agentId) : getAgent('default');

  // 从 URL 同步 sessionId
  useEffect(() => {
    if (urlSessionId && urlSessionId !== currentSessionId) {
      setCurrentSessionId(urlSessionId);
    } else if (!urlSessionId && !isSettingsPage && !pageTitle && currentSessionId) {
      setCurrentSessionId(null);
    }
  }, [urlSessionId, isSettingsPage, pageTitle, currentSessionId, setCurrentSessionId]);

  // 当切换会话时，恢复该会话的模型选择
  useEffect(() => {
    if (currentSessionId && sessionModels[currentSessionId]) {
      setSelectedModel(sessionModels[currentSessionId]);
    } else if (currentSession) {
      setSelectedModel(currentSession.model);
    }
  }, [currentSessionId, sessionModels, currentSession, setSelectedModel]);

  // 初始加载会话列表
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // 更新当前会话的模型
  const updateCurrentSessionModel = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    if (currentSessionId) {
      updateSessionModel(currentSessionId, modelId);
    }
  }, [currentSessionId, updateSessionModel, setSelectedModel]);

  // 删除会话处理
  const handleDeleteSession = useCallback(async (sessionId: string) => {
    const navigateTo = await deleteSession(sessionId);
    if (navigateTo) {
      navigate(navigateTo);
    }
  }, [deleteSession, navigate]);

  // 侧边栏事件处理
  const handleNewChat = useCallback(() => {
    setCurrentSessionId(null);
    navigate('/');
  }, [navigate, setCurrentSessionId]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId);
    navigate(`/chat/${sessionId}`);
  }, [navigate, setCurrentSessionId]);

  const handleOpenSettings = useCallback(() => {
    navigate('/settings');
  }, [navigate]);

  const handleNavigate = useCallback((to: string) => {
    navigate(to);
  }, [navigate]);

  // Sidebar 状态
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  // 权限模式状态
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');

  // 主内容区
  let content: JSX.Element;
  if (isSettingsPage) {
    content = (
      <SettingsPage
        agents={agents}
        onAdd={addAgent}
        onUpdate={updateAgent}
        onDelete={deleteAgent}
      />
    );
  } else if (path === '/groups') {
    content = <GroupsPage refreshKey={refreshKey} dashboard={dashboard ?? undefined} />;
  } else if (path === '/messages') {
    content = <MessagesPage refreshKey={refreshKey} />;
  } else if (path === '/summary') {
    content = (
      <SummaryPage
        refreshKey={refreshKey}
        aiConfigured={dashboard?.aiConfigured ?? true}
        dashboard={dashboard ?? undefined}
        onNavigateSettings={handleOpenSettings}
      />
    );
  } else if (path === '/notifications') {
    content = (
      <NotificationsPage
        notifications={notif.notifications}
        unread={notif.unread}
        loading={notif.loading}
        refresh={notif.refresh}
        markRead={notif.markRead}
        markAllRead={notif.markAllRead}
      />
    );
  } else if (path === '/schedules') {
    content = <SchedulesPage refreshKey={refreshKey} />;
  } else if (path === '/priorities') {
    content = <PrioritiesPage refreshKey={refreshKey} />;
  } else {
    content = (
      <ChatPage
        currentSession={currentSession}
        models={models}
        selectedModel={selectedModel}
        agents={agents}
        isLoading={isLoading}
        inputValue={inputValue}
        permissionRequest={permissionRequest}
        permissionMode={permissionMode}
        onSendMessage={sendMessage}
        onStop={handleStop}
        onInputChange={setInputValue}
        onModelChange={updateCurrentSessionModel}
        onPermissionAllow={handlePermissionAllow}
        onPermissionDeny={handlePermissionDeny}
        onPermissionModeChange={setPermissionMode}
      />
    );
  }

  return (
    <div 
      className="flex h-screen w-screen"
      style={{ backgroundColor: 'var(--td-bg-color-page)' }}
    >
      {/* 侧边栏 */}
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        currentPath={path}
        sidebarOpen={sidebarOpen}
        agents={agents}
        unreadCount={notif.unread}
        getAgent={getAgent}
        onNewChat={handleNewChat}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onOpenSettings={handleOpenSettings}
        onNavigate={handleNavigate}
      />

      {/* 主内容区 */}
      <main 
        className="flex-1 flex flex-col min-w-0"
        style={{ backgroundColor: 'var(--td-bg-color-page)' }}
      >
        {/* 顶部栏 */}
        <Header
          isSettingsPage={isSettingsPage}
          sidebarOpen={sidebarOpen}
          theme={theme}
          currentSession={currentSession}
          currentAgent={currentAgent}
          models={models}
          title={pageTitle}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onToggleTheme={toggleTheme}
          onRefreshModels={fetchModels}
        />

        {content}
      </main>
    </div>
  );
}

export default App;
