/* ──────────────────────────────────────────────────────────
 *  GroupChannelSidebar — Discord-style channel list for a group
 * ────────────────────────────────────────────────────────── */

import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { useProfileStore } from '../stores/profileStore';
import { useConnectionStore } from '../stores/connectionStore';
import {
  Hash, Volume, ChevronDown, Settings, Search, ArrowLeft,
  Shield, Wifi, WifiOff, Users,
} from './Icons';
import { AvatarWithStatus } from './AvatarWithStatus';
import { ProfilePopup } from './ProfilePopup';
import { useState } from 'react';
import type { GroupChannel } from '../types';
import { GroupSettings } from './GroupSettings';
import { resolveGroupPermissions } from '../utils/groupPermissions';
import { useCallStore } from '../stores/callStore';
import './GroupChannelSidebar.css';
import { GROUP_MESSAGING_CONTAINMENT_NOTICE } from '@darklock/ridgeline-security-capabilities';

/* ── Channel type → icon ──────────────────────────────── */
function ChannelIcon({ type, size = 18 }: { type: GroupChannel['type']; size?: number }) {
  switch (type) {
    case 'voice':
    case 'stage':
      return <Volume size={size} />;
    case 'announcement':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      );
    case 'forum':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    default: // text
      return <Hash size={size} />;
  }
}

export function GroupChannelSidebar() {
  const [showProfile, setShowProfile] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const activeGroupId = useChatStore(s => s.activeGroupId);
  const groups = useChatStore(s => s.groups);
  const activeChannelId = useChatStore(s => s.activeChannelId);
  const setActiveChannel = useChatStore(s => s.setActiveChannel);
  const setActiveConversation = useChatStore(s => s.setActiveConversation);
  const setSidebarMode = useChatStore(s => s.setSidebarMode);
  const toggleCategory = useChatStore(s => s.toggleCategory);
  const setScreen = useAuthStore(s => s.setScreen);
  const activeCall = useCallStore(s => s.activeCall);
  const startCall = useCallStore(s => s.startCall);

  const userId = useAuthStore(s => s.userId);
  const displayName = useAuthStore(s => s.displayName);
  const profile = useProfileStore();
  const connected = useConnectionStore(s => s.status === 'connected');

  const group = activeGroupId ? groups[activeGroupId] : null;
  const permissions = resolveGroupPermissions(group, userId);
  if (!group) return null;

  const isVoiceChannel = (channel: GroupChannel) => channel.type === 'voice' || channel.type === 'stage';

  const canAccessChannel = (channel: GroupChannel) => {
    if (isVoiceChannel(channel)) {
      return permissions.useVoice;
    }
    return permissions.readMessages;
  };

  const categories = [...(group.categories ?? [])].sort((a, b) => a.position - b.position);
  const channels = group.channels ?? [];

  // Channels grouped by category
  const uncategorized = channels
    .filter(ch => !ch.categoryId)
    .sort((a, b) => a.position - b.position);

  return (
    <aside className="group-channel-sidebar">
      {/* ── Header ──────────────────────────────── */}
      <div className="gcs-header">
        <button
          className="gcs-header__back"
          onClick={() => {
            setActiveConversation(null);
            setSidebarMode('group');
          }}
          aria-label="Back to conversations"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="gcs-header__title">
          <button className="gcs-header__name" onClick={() => setShowSettings(true)}>
            <span>{group.name}</span>
            <ChevronDown size={14} />
          </button>
          <span className="gcs-header__meta">
            {channels.length} channels · {group.members.length} members
          </span>
        </div>
        <button className="gcs-header__search" aria-label="Search channels">
          <Search size={16} />
        </button>
      </div>

      {/* ── Settings modal ──────────────────────── */}
      {showSettings && activeGroupId && (
        <GroupSettings groupId={activeGroupId} onClose={() => setShowSettings(false)} />
      )}

      {/* ── Channel list ────────────────────────── */}
      <div className="gcs-list">
        {/* Uncategorized channels first */}
        {uncategorized.length > 0 && (
          <div className="gcs-category">
            <div className="gcs-category__header gcs-category__header--static">
              <span className="gcs-category__name">Channels</span>
            </div>
            {uncategorized.map(ch => (
              <ChannelRow
                key={ch.id}
                channel={ch}
                active={ch.id === activeChannelId}
                disabled={!canAccessChannel(ch)}
                onClick={() => {
                  if (!canAccessChannel(ch)) return;
                  setActiveConversation(group.id);
                  setActiveChannel(ch.id);

                   if (!isVoiceChannel(ch)) return;
                   if (activeCall) return;

                   void startCall(group.id, 'audio');
                }}
                title={(() => {
                  if (!canAccessChannel(ch)) return 'You do not have permission to use this channel';
                  if (!isVoiceChannel(ch)) return undefined;
                  if (activeCall) return 'A call is already active. End it before joining another voice channel.';
                  return `Join ${ch.name} voice channel`;
                })()}
              />
            ))}
          </div>
        )}

        {categories.map(cat => {
          const catChannels = channels
            .filter(ch => ch.categoryId === cat.id)
            .sort((a, b) => a.position - b.position);

          return (
            <div key={cat.id} className="gcs-category">
              <button
                className="gcs-category__header"
                onClick={() => activeGroupId && toggleCategory(activeGroupId, cat.id)}
              >
                <ChevronDown size={12} className={cat.collapsed ? 'gcs-chevron--collapsed' : ''} />
                <span className="gcs-category__name">{cat.name}</span>
              </button>
              {!cat.collapsed && catChannels.map(ch => (
                <ChannelRow
                  key={ch.id}
                  channel={ch}
                  active={ch.id === activeChannelId}
                  disabled={!canAccessChannel(ch)}
                  onClick={() => {
                    if (!canAccessChannel(ch)) return;
                    setActiveConversation(group.id);
                    setActiveChannel(ch.id);

                    if (!isVoiceChannel(ch)) return;
                    if (activeCall) return;

                    void startCall(group.id, 'audio');
                  }}
                  title={(() => {
                    if (!canAccessChannel(ch)) return 'You do not have permission to use this channel';
                    if (!isVoiceChannel(ch)) return undefined;
                    if (activeCall) return 'A call is already active. End it before joining another voice channel.';
                    return `Join ${ch.name} voice channel`;
                  })()}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* ── Member count ────────────────────────── */}
      <div className="gcs-members">
        <Users size={14} />
        <span>{group.members.length} member{group.members.length !== 1 ? 's' : ''}</span>
      </div>

      {/* ── Footer / security ───────────────────── */}
      <div className="gcs-footer">
        <div className="gcs-footer__security">
          <Shield size={12} />
          <span title={GROUP_MESSAGING_CONTAINMENT_NOTICE}>Group messaging paused</span>
        </div>
      </div>

      {/* ── User panel (reused design) ──────────── */}
      <div className="gcs-user-panel" onClick={() => setShowProfile(!showProfile)}>
        <div className="gcs-user-panel__avatar">
          <AvatarWithStatus
            name={profile.displayName || displayName || 'User'}
            avatarUrl={profile.avatar}
            statusText={profile.statusText}
            statusEmoji={profile.statusEmoji}
            presence={profile.presence}
            size={36}
            editable
          />
        </div>
        <div className="gcs-user-panel__info">
          <span className="gcs-user-panel__name" style={{ color: profile.usernameColor }}>
            {profile.displayName || displayName || 'User'}
          </span>
          <span className="gcs-user-panel__status">
            {connected
              ? <><Wifi size={12} /> Connected</>
              : <><WifiOff size={12} /> Offline</>
            }
          </span>
        </div>
        <button className="gcs-user-panel__btn" onClick={(e) => { e.stopPropagation(); setScreen('settings'); }}>
          <Settings size={20} />
        </button>
        <ProfilePopup open={showProfile} onClose={() => setShowProfile(false)} />
      </div>
    </aside>
  );
}

/* ── Channel row ─────────────────────────────────────────── */

function ChannelRow({ channel, active, disabled = false, onClick, title }: {
  channel: GroupChannel;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}) {
  const isVoiceChannel = channel.type === 'voice' || channel.type === 'stage';

  return (
    <button
      className={`gcs-channel ${isVoiceChannel ? 'gcs-channel--voice' : 'gcs-channel--text'}${active ? ' gcs-channel--active' : ''}${disabled ? ' gcs-channel--disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <ChannelIcon type={channel.type} size={18} />
      <span className="gcs-channel__name">{channel.name}</span>
      <span className="gcs-channel__actions">
        {isVoiceChannel
          ? <span className="gcs-channel__voice-hint">VC</span>
          : null}
      </span>
    </button>
  );
}
