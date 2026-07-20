import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useAuthStore } from './stores/authStore';
import { useChatStore } from './stores/chatStore';
import { useCallStore } from './stores/callStore';
import { setUpdateRestartSafety } from './stores/updateStore';
import { useFriendStore } from './stores/friendStore';
import { canAccessAdminPanel } from './utils/adminAccess';
import { useSettingsEffects } from './hooks/useSettingsEffects';
import { useRlyConnection } from './hooks/useRlyConnection';
import { useSpotifyActivitySync } from './hooks/useSpotifyActivitySync';
import { LoginScreen } from './pages/Login';
import { UnlockScreen } from './pages/Unlock';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { UpdateBanner } from './components/UpdateBanner';
import { GroupChannelSidebar } from './components/GroupChannelSidebar';
import {
  MobileActivityPanel,
  MobileBottomNav,
  type MobileTabKey,
} from './components/MobilePanels';
import { TitleBar } from './components/TitleBar';
import './theme/index.css';
import './App.css';
import './theme/messenger-skin.css';

// Lazy-loaded screens — only fetched when the user actually navigates to them.
// Cuts ~600 kB off the initial bundle.
const OnboardingScreen = lazy(() => import('./pages/Onboarding').then(m => ({ default: m.OnboardingScreen })));
const Settings        = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const MeProfile       = lazy(() => import('./pages/MeProfile').then(m => ({ default: m.MeProfile })));
const AdminPanel      = lazy(() => import('./pages/Admin').then(m => ({ default: m.AdminPanel })));
const ShopPage        = lazy(() => import('./pages/Shop').then(m => ({ default: m.Shop })));

function ScreenFallback() {
  return (
    <div className="app-screen-fallback" role="status" aria-label="Loading">
      <div className="dl-loading__dots"><span /><span /><span /></div>
    </div>
  );
}

export function App() {
  const screen = useAuthStore(s => s.screen);
  const userId = useAuthStore(s => s.userId);
  const systemRole = useAuthStore(s => s.systemRole);
  const activeConversation = useChatStore(s => s.activeConversation);
  const sidebarMode = useChatStore(s => s.sidebarMode);
  const activeGroupId = useChatStore(s => s.activeGroupId);
  const setSidebarMode = useChatStore(s => s.setSidebarMode);
  const setActiveConversation = useChatStore(s => s.setActiveConversation);
  const conversations = useChatStore(s => s.conversations ?? {});

  const incomingRequests = useFriendStore(s => Array.isArray(s.incoming) ? s.incoming.length : 0);
  const incomingCall = useCallStore(s => s.incomingCall);
  const activeCall = useCallStore(s => s.activeCall);

  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTabKey>('chats');

  const canAccessAdmin = canAccessAdminPanel(userId, systemRole);
  const showGroupChannels = sidebarMode === 'group' && !!activeGroupId;
  const mobilePaneClass = showGroupChannels ? 'group' : 'dm';
  const showUtilityPane = isMobileViewport && !activeConversation && mobileTab === 'activity';

  useEffect(() => {
    setUpdateRestartSafety({ activeCall: activeCall !== null });
  }, [activeCall]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia('(max-width: 768px)');
    const sync = () => setIsMobileViewport(media.matches);

    sync();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', sync);
      return () => media.removeEventListener('change', sync);
    }

    media.addListener(sync);
    return () => media.removeListener(sync);
  }, []);

  useEffect(() => {
    if (!isMobileViewport) return;

    if (mobileTab === 'chats') {
      if (sidebarMode !== 'dm') setSidebarMode('dm');
      return;
    }

    if (mobileTab === 'groups') {
      if (sidebarMode !== 'group') setSidebarMode('group');
      return;
    }

    if (activeConversation) {
      setActiveConversation(null);
    }
  }, [
    activeConversation,
    isMobileViewport,
    mobileTab,
    setActiveConversation,
    setSidebarMode,
    sidebarMode,
  ]);

  useEffect(() => {
    if (!isMobileViewport || !activeConversation) return;
    if (mobileTab === 'activity') {
      setMobileTab(sidebarMode === 'group' ? 'groups' : 'chats');
    }
  }, [activeConversation, isMobileViewport, mobileTab, sidebarMode]);

  const unreadSummary = useMemo(() => {
    let dm = 0;
    let group = 0;

    for (const conversation of Object.values(conversations)) {
      const unread = Math.max(conversation.unread ?? 0, conversation.unreadCount ?? 0);
      if (unread <= 0) continue;
      if (conversation.type === 'group') group += unread;
      else dm += unread;
    }

    return { dm, group, total: dm + group };
  }, [conversations]);

  const activityBadgeCount = unreadSummary.total + incomingRequests + (incomingCall ? 1 : 0);

  const handleMobileTabChange = (tab: MobileTabKey) => {
    if (tab === mobileTab) {
      if (tab === 'chats' || tab === 'groups') {
        setActiveConversation(null);
      }
      return;
    }

    if (tab === 'chats' || tab === 'groups' || tab === 'activity') {
      setActiveConversation(null);
    }

    setMobileTab(tab);
  };

  const openConversationFromActivity = (conversationId: string, type: 'dm' | 'group') => {
    if (type === 'group') {
      setSidebarMode('group', conversationId);
      setMobileTab('groups');
    } else {
      setSidebarMode('dm');
      setMobileTab('chats');
    }

    setActiveConversation(conversationId);
  };

  // Apply all settings side-effects (theme, font, Electron IPC, auto-lock, etc.)
  useSettingsEffects();

  // Open/close WebSocket relay connection and handle presence + messages
  useRlyConnection();

  // Spotify tokens stay in Electron; this only syncs the opt-in public snapshot.
  useSpotifyActivitySync();

  if (screen === 'login') return <LoginScreen />;
  if (screen === 'unlock') return <UnlockScreen />;
  if (screen === 'onboarding') return <Suspense fallback={<ScreenFallback />}><OnboardingScreen /></Suspense>;
  if (screen === 'settings')   return <Suspense fallback={<ScreenFallback />}><Settings /></Suspense>;
  if (screen === 'me')         return <Suspense fallback={<ScreenFallback />}><MeProfile /></Suspense>;
  if (screen === 'shop')       return <Suspense fallback={<ScreenFallback />}><ShopPage /></Suspense>;
  if (screen === 'admin' && canAccessAdmin) return <Suspense fallback={<ScreenFallback />}><AdminPanel /></Suspense>;

  // Main chat layout — mobile-chat-open class drives sidebar/chat toggle on small screens
  return (
    <div className="app-layout">
      <TitleBar />
      <UpdateBanner />
      <div className={`app-body app-body--${mobilePaneClass}${activeConversation ? ' mobile-chat-open' : ''}${showUtilityPane ? ` app-body--${mobileTab}` : ''}`}>
        {showUtilityPane ? (
          <MobileActivityPanel
            onOpenConversation={openConversationFromActivity}
          />
        ) : (
          <>
            <Sidebar />
            {showGroupChannels && <GroupChannelSidebar />}
            <ChatView />
          </>
        )}
      </div>

      {isMobileViewport && !activeConversation && (
        <MobileBottomNav
          activeTab={mobileTab}
          onChange={handleMobileTabChange}
          chatsBadge={unreadSummary.dm}
          groupsBadge={unreadSummary.group}
          activityBadge={activityBadgeCount}
        />
      )}
    </div>
  );
}
