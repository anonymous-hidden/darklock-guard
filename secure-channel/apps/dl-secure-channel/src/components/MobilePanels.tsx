import { useMemo, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useCallStore } from '../stores/callStore';
import { useChatStore, type UIConversation } from '../stores/chatStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useFriendStore, type FriendRequest } from '../stores/friendStore';
import { useProfileStore, PRESENCE_COLORS } from '../stores/profileStore';
import { useSettingsStore } from '../stores/settingsStore';
import { AvatarWithStatus } from './AvatarWithStatus';
import { Badge } from './Shared';
import {
  AtSign,
  Bell,
  BellOff,
  Check,
  Lock,
  Mail,
  MessageCircle,
  Phone,
  Settings,
  Shield,
  User,
  Users,
  X,
} from './Icons';
import * as ws from '../net/wsClient';
import './MobilePanels.css';

export type MobileTabKey = 'chats' | 'groups' | 'activity';

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))}h ago`;
  return `${Math.max(1, Math.floor(diff / 86_400_000))}d ago`;
}

function getUnreadCount(conversation: UIConversation): number {
  return Math.max(conversation.unread ?? 0, conversation.unreadCount ?? 0);
}

interface MobileBottomNavProps {
  activeTab: MobileTabKey;
  onChange: (tab: MobileTabKey) => void;
  chatsBadge: number;
  groupsBadge: number;
  activityBadge: number;
}

export function MobileBottomNav({
  activeTab,
  onChange,
  chatsBadge,
  groupsBadge,
  activityBadge,
}: MobileBottomNavProps) {
  return (
    <nav className="app-mobile-bottom-nav" aria-label="Mobile sections">
      <button
        className={`app-mobile-bottom-nav__item${activeTab === 'chats' ? ' app-mobile-bottom-nav__item--active' : ''}`}
        onClick={() => onChange('chats')}
      >
        <MessageCircle size={18} />
        <span>Chats</span>
        {chatsBadge > 0 && <span className="app-mobile-bottom-nav__badge">{chatsBadge > 99 ? '99+' : chatsBadge}</span>}
      </button>

      <button
        className={`app-mobile-bottom-nav__item${activeTab === 'groups' ? ' app-mobile-bottom-nav__item--active' : ''}`}
        onClick={() => onChange('groups')}
      >
        <Users size={18} />
        <span>Groups</span>
        {groupsBadge > 0 && <span className="app-mobile-bottom-nav__badge">{groupsBadge > 99 ? '99+' : groupsBadge}</span>}
      </button>

      <button
        className={`app-mobile-bottom-nav__item${activeTab === 'activity' ? ' app-mobile-bottom-nav__item--active' : ''}`}
        onClick={() => onChange('activity')}
      >
        <AtSign size={18} />
        <span>Notifications</span>
        {activityBadge > 0 && <span className="app-mobile-bottom-nav__badge">{activityBadge > 99 ? '99+' : activityBadge}</span>}
      </button>
    </nav>
  );
}

interface MobileActivityPanelProps {
  onOpenConversation: (conversationId: string, type: 'dm' | 'group') => void;
}

export function MobileActivityPanel({ onOpenConversation }: MobileActivityPanelProps) {
  const userId = useAuthStore((s) => s.userId);
  const displayName = useAuthStore((s) => s.displayName);

  const conversations = useChatStore((s) => s.conversations ?? {});
  const contacts = useChatStore((s) => s.contacts ?? {});
  const groups = useChatStore((s) => s.groups ?? {});
  const addContact = useChatStore((s) => s.addContact);
  const addConversation = useChatStore((s) => s.addConversation);

  const incomingRequests = useFriendStore((s) => (Array.isArray(s.incoming) ? s.incoming : []));
  const outgoingRequests = useFriendStore((s) => (Array.isArray(s.outgoing) ? s.outgoing : []));
  const acceptRequest = useFriendStore((s) => s.acceptRequest);
  const rejectRequest = useFriendStore((s) => s.rejectRequest);
  const removeIncoming = useFriendStore((s) => s.removeIncoming);
  const addFriend = useFriendStore((s) => s.addFriend);

  const incomingCall = useCallStore((s) => s.incomingCall);
  const activeCall = useCallStore((s) => s.activeCall);

  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);

  const unreadConversations = useMemo(() => {
    return Object.values(conversations)
      .filter((conversation) => getUnreadCount(conversation) > 0)
      .sort((a, b) => b.lastActivity - a.lastActivity);
  }, [conversations]);

  const unreadTotal = useMemo(
    () => unreadConversations.reduce((sum, conversation) => sum + getUnreadCount(conversation), 0),
    [unreadConversations],
  );

  const notificationCount = unreadTotal
    + incomingRequests.length
    + (incomingCall ? 1 : 0)
    + (activeCall ? 1 : 0)
    + (outgoingRequests.length > 0 ? 1 : 0);
  const hasNotifications = notificationCount > 0;

  const getConversationName = (conversation: UIConversation): string => {
    if (conversation.type === 'group') {
      return groups[conversation.id]?.name ?? conversation.name ?? 'Group';
    }

    const members = Array.isArray(conversation.participantIds)
      ? conversation.participantIds
      : (Array.isArray((conversation as unknown as { members?: string[] }).members)
        ? (conversation as unknown as { members: string[] }).members
        : []);
    const otherId = members.find((id) => id !== userId) ?? '';
    return contacts[otherId]?.displayName ?? otherId.slice(0, 8);
  };

  const handleAcceptRequest = async (request: FriendRequest) => {
    if (!userId) return;
    setBusyRequestId(request.id);

    const accepted = await acceptRequest(request.id, userId);
    if (accepted) {
      removeIncoming(request.id);
      addFriend({ userId: request.fromUser, displayName: request.displayName });

      addContact({
        id: request.fromUser,
        displayName: request.displayName,
        identityKey: '',
        trustLevel: 'unverified',
        addedAt: Date.now(),
      });

      const conversationId = [userId, request.fromUser].sort().join(':');
      if (!conversations[conversationId]) {
        addConversation({
          id: conversationId,
          type: 'dm',
          members: [userId, request.fromUser],
          createdAt: Date.now(),
          unreadCount: 0,
        });
      }

      void ws.sendFriendAccept(request.fromUser, displayName ?? userId);
      onOpenConversation(conversationId, 'dm');
    }

    setBusyRequestId(null);
  };

  const handleRejectRequest = async (request: FriendRequest) => {
    if (!userId) return;
    setBusyRequestId(request.id);
    await rejectRequest(request.id, userId);
    removeIncoming(request.id);
    setBusyRequestId(null);
  };

  return (
    <section className="mobile-pane mobile-pane--activity">
      <header className="mobile-notifications-head">
        <h2>Notifications</h2>
      </header>
      <div className="mobile-notifications-divider" />

      <div className="mobile-notifications-feed">
        {!hasNotifications && (
          <p className="mobile-notification-empty">No notifications right now.</p>
        )}

        {incomingCall && (
          <button
            className="mobile-notification-row mobile-notification-row--interactive"
            onClick={() => onOpenConversation(incomingCall.conversationId, incomingCall.mode)}
          >
            <span className="mobile-notification-row__icon" aria-hidden="true">
              <Phone size={15} />
            </span>
            <span className="mobile-notification-row__content">
              <span className="mobile-notification-row__title">Incoming {incomingCall.kind} call</span>
              <span className="mobile-notification-row__text">{incomingCall.fromDisplayName}</span>
            </span>
            <span className="mobile-notification-row__side">
              <Badge variant="warning">Call</Badge>
              <span className="mobile-notification-row__time">now</span>
            </span>
          </button>
        )}

        {activeCall && (
          <button
            className="mobile-notification-row mobile-notification-row--interactive"
            onClick={() => onOpenConversation(activeCall.conversationId, activeCall.mode)}
          >
            <span className="mobile-notification-row__icon" aria-hidden="true">
              <Phone size={15} />
            </span>
            <span className="mobile-notification-row__content">
              <span className="mobile-notification-row__title">Active call</span>
              <span className="mobile-notification-row__text">
                {activeCall.mode === 'group' ? 'Group call in progress' : 'Direct call in progress'}
              </span>
            </span>
            <span className="mobile-notification-row__side">
              <Badge variant="warning">Live</Badge>
              <span className="mobile-notification-row__time">now</span>
            </span>
          </button>
        )}

        {incomingRequests.slice(0, 5).map((request) => (
          <article key={request.id} className="mobile-notification-row">
            <span className="mobile-notification-row__icon" aria-hidden="true">
              <User size={15} />
            </span>
            <span className="mobile-notification-row__content">
              <span className="mobile-notification-row__title">{request.displayName}</span>
              <span className="mobile-notification-row__text">Sent you a friend request</span>
            </span>
            <span className="mobile-notification-row__actions">
              <button
                className="mobile-notification-icon-btn mobile-notification-icon-btn--accept"
                onClick={() => void handleAcceptRequest(request)}
                disabled={busyRequestId === request.id}
                title="Accept request"
                aria-label={`Accept friend request from ${request.displayName}`}
              >
                <Check size={14} />
              </button>
              <button
                className="mobile-notification-icon-btn mobile-notification-icon-btn--reject"
                onClick={() => void handleRejectRequest(request)}
                disabled={busyRequestId === request.id}
                title="Reject request"
                aria-label={`Reject friend request from ${request.displayName}`}
              >
                <X size={14} />
              </button>
            </span>
          </article>
        ))}

        {unreadConversations.map((conversation) => {
          const unread = getUnreadCount(conversation);
          return (
            <button
              key={conversation.id}
              className="mobile-notification-row mobile-notification-row--interactive"
              onClick={() => onOpenConversation(conversation.id, conversation.type)}
            >
              <span className="mobile-notification-row__icon" aria-hidden="true">
                {conversation.type === 'group' ? <Users size={15} /> : <MessageCircle size={15} />}
              </span>
              <span className="mobile-notification-row__content">
                <span className="mobile-notification-row__title">{getConversationName(conversation)}</span>
                <span className="mobile-notification-row__text">{conversation.lastMessage || 'New messages'}</span>
              </span>
              <span className="mobile-notification-row__side">
                <Badge variant="danger">{unread > 99 ? '99+' : unread}</Badge>
                <span className="mobile-notification-row__time">{formatTimeAgo(conversation.lastActivity)}</span>
              </span>
            </button>
          );
        })}

        {outgoingRequests.length > 0 && (
          <article className="mobile-notification-row">
            <span className="mobile-notification-row__icon" aria-hidden="true">
              <Mail size={15} />
            </span>
            <span className="mobile-notification-row__content">
              <span className="mobile-notification-row__title">Pending requests</span>
              <span className="mobile-notification-row__text">
                {outgoingRequests.length} outgoing request{outgoingRequests.length === 1 ? '' : 's'} pending
              </span>
            </span>
          </article>
        )}
      </div>
    </section>
  );
}

export function MobileYouPanel() {
  const setScreen = useAuthStore((s) => s.setScreen);
  const lock = useAuthStore((s) => s.lock);
  const userId = useAuthStore((s) => s.userId);
  const displayName = useAuthStore((s) => s.displayName);

  const profile = useProfileStore();
  const status = useConnectionStore((s) => s.status);

  const conversations = useChatStore((s) => s.conversations ?? {});
  const groups = useChatStore((s) => s.groups ?? {});

  const notifications = useSettingsStore((s) => s.notifications);
  const doNotDisturb = useSettingsStore((s) => s.doNotDisturb);
  const mentionsOnly = useSettingsStore((s) => s.mentionsOnly);
  const toggleNotifications = useSettingsStore((s) => s.toggleNotifications);
  const toggleDoNotDisturb = useSettingsStore((s) => s.toggleDoNotDisturb);
  const toggleMentionsOnly = useSettingsStore((s) => s.toggleMentionsOnly);

  const counts = useMemo(() => {
    let dmCount = 0;
    let groupCount = 0;
    for (const conversation of Object.values(conversations)) {
      if (conversation.type === 'group') {
        groupCount += 1;
      } else {
        dmCount += 1;
      }
    }

    return {
      dmCount,
      groupCount,
      knownGroupCount: Object.keys(groups).length,
    };
  }, [conversations, groups]);

  const profileName = profile.displayName || displayName || userId || 'User';

  return (
    <section className="mobile-pane mobile-pane--you">
      <header className="mobile-pane__header">
        <h2>You</h2>
        <p>Profile, account actions, and notification controls.</p>
      </header>

      <section className="mobile-you__card">
        <AvatarWithStatus
          name={profileName}
          avatarUrl={profile.avatar}
          statusText={profile.statusText}
          statusEmoji={profile.statusEmoji}
          presence={profile.presence}
          online={status === 'connected'}
          statusColor={status === 'connected' ? PRESENCE_COLORS[profile.presence] : undefined}
          size={52}
        />
        <div className="mobile-you__identity">
          <span className="mobile-you__name" style={{ color: profile.usernameColor || undefined }}>{profileName}</span>
          <span className="mobile-you__id">@{userId || 'unknown'}</span>
          <span className={`mobile-you__connection mobile-you__connection--${status}`}>{status}</span>
        </div>
      </section>

      <div className="mobile-you__stats">
        <div className="mobile-stat">
          <span className="mobile-stat__label">Direct Chats</span>
          <span className="mobile-stat__value">{counts.dmCount}</span>
        </div>
        <div className="mobile-stat">
          <span className="mobile-stat__label">Group Chats</span>
          <span className="mobile-stat__value">{counts.groupCount}</span>
        </div>
        <div className="mobile-stat">
          <span className="mobile-stat__label">Groups</span>
          <span className="mobile-stat__value">{counts.knownGroupCount}</span>
        </div>
      </div>

      <section className="mobile-pane__section">
        <div className="mobile-pane__section-head">
          <h3>Quick Actions</h3>
        </div>
        <div className="mobile-you__actions">
          <button className="mobile-pane__action" onClick={() => setScreen('me')}>
            <User size={14} />
            Profile
          </button>
          <button className="mobile-pane__action" onClick={() => setScreen('settings')}>
            <Settings size={14} />
            Settings
          </button>
          <button className="mobile-pane__action mobile-pane__action--danger" onClick={lock}>
            <Lock size={14} />
            Lock
          </button>
        </div>
      </section>

      <section className="mobile-pane__section">
        <div className="mobile-pane__section-head">
          <h3>Notifications</h3>
        </div>

        <div className="mobile-toggle-row">
          <div className="mobile-toggle-row__label">
            <Bell size={14} />
            <span>Notifications</span>
          </div>
          <button
            className={`mobile-toggle${notifications ? ' mobile-toggle--on' : ''}`}
            onClick={toggleNotifications}
            aria-pressed={notifications}
          >
            <span className="mobile-toggle__knob" />
          </button>
        </div>

        <div className="mobile-toggle-row">
          <div className="mobile-toggle-row__label">
            {doNotDisturb ? <BellOff size={14} /> : <Bell size={14} />}
            <span>Do Not Disturb</span>
          </div>
          <button
            className={`mobile-toggle${doNotDisturb ? ' mobile-toggle--on' : ''}`}
            onClick={toggleDoNotDisturb}
            aria-pressed={doNotDisturb}
          >
            <span className="mobile-toggle__knob" />
          </button>
        </div>

        <div className="mobile-toggle-row">
          <div className="mobile-toggle-row__label">
            <Mail size={14} />
            <span>Mentions Only</span>
          </div>
          <button
            className={`mobile-toggle${mentionsOnly ? ' mobile-toggle--on' : ''}`}
            onClick={toggleMentionsOnly}
            aria-pressed={mentionsOnly}
          >
            <span className="mobile-toggle__knob" />
          </button>
        </div>
      </section>

      <section className="mobile-pane__section mobile-pane__section--security">
        <div className="mobile-pane__section-head">
          <h3>Security</h3>
        </div>
        <p>
          <Shield size={14} />
          Direct-message encryption is available when secure sessions are established.
        </p>
      </section>
    </section>
  );
}
