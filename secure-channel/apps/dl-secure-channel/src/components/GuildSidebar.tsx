/* ──────────────────────────────────────────────────────────
 *  GuildSidebar — Discord-style far-left icon bar
 *  Shows Home (DMs) + group icons + create-group button
 * ────────────────────────────────────────────────────────── */

import { useState } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { Plus } from './Icons';
import ridgelineScImg from '../assets/ridgeline-sc.png';
import { CreateGroupModal } from './GroupManagement';
import './GuildSidebar.css';

// Curated palette of rich, harmonious gradients (like Discord/Linear)
const GROUP_GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', // indigo → purple
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', // pink → red
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', // blue → cyan
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', // green → teal
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', // pink → yellow
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)', // teal → deep purple
  'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)', // mint → rose
  'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)', // coral → pink
  'linear-gradient(135deg, #f6d365 0%, #fda085 100%)', // gold → orange
  'linear-gradient(135deg, #5ee7df 0%, #b490ca 100%)', // aqua → lavender
  'linear-gradient(135deg, #ff6a88 0%, #ff99ac 100%)', // rose
  'linear-gradient(135deg, #48c6ef 0%, #6f86d6 100%)', // sky → periwinkle
];

function groupGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GROUP_GRADIENTS[Math.abs(hash) % GROUP_GRADIENTS.length];
}

const RidgelineHomeIcon = () => (
  <span className="guild-sidebar__home-mark" aria-hidden="true">
    <img src={ridgelineScImg} alt="" className="guild-sidebar__home-img" />
  </span>
);

export function GuildSidebar() {
  const [showCreateGroup, setShowCreateGroup] = useState(false);

  const conversations = useChatStore(s => s.conversations);
  const groups = useChatStore(s => s.groups);
  const activeConversation = useChatStore(s => s.activeConversation);
  const activeGroupId = useChatStore(s => s.activeGroupId);
  const setActive = useChatStore(s => s.setActiveConversation);
  const setSidebarMode = useChatStore(s => s.setSidebarMode);
  const setScreen = useAuthStore(s => s.setScreen);

  const isGroupActive = !!activeGroupId;

  // All group conversations sorted by last activity
  const groupConvs = Object.values(conversations)
    .filter(c => c.type === 'group')
    .sort((a, b) => b.lastActivity - a.lastActivity);

  // Total DM unread count
  const dmUnread = Object.values(conversations)
    .filter(c => c.type === 'dm')
    .reduce((sum, c) => sum + c.unread, 0);

  return (
    <nav className="guild-sidebar" aria-label="Servers">
      {/* ── Home (DMs) ──────────────────────────── */}
      <div className="guild-sidebar__tooltip-wrap" data-tooltip="Direct Messages">
        <button
          className={`guild-sidebar__icon guild-sidebar__home ${!isGroupActive ? 'guild-sidebar__icon--active' : ''}`}
          onClick={() => { setActive(null); setSidebarMode('dm'); setScreen('main'); }}
          aria-label="Direct Messages"
        >
          <RidgelineHomeIcon />
          {dmUnread > 0 && (
            <span className="guild-sidebar__badge">{dmUnread > 99 ? '99+' : dmUnread}</span>
          )}
        </button>
        {!isGroupActive && <span className="guild-sidebar__active-pill" />}
      </div>

      {groupConvs.length > 0 && <div className="guild-sidebar__divider" />}

      {/* ── Group icons ─────────────────────────── */}
      <div className="guild-sidebar__groups">
        {groupConvs.map(conv => {
          const group = groups[conv.id];
          const name = group?.name ?? 'Group';
          const active = conv.id === activeGroupId;
          const initial = name.charAt(0).toUpperCase();

          return (
            <div key={conv.id} className="guild-sidebar__tooltip-wrap" data-tooltip={name}>
              <button
                className={`guild-sidebar__icon guild-sidebar__group ${active ? 'guild-sidebar__icon--active' : ''}`}
                style={!group?.avatar ? { backgroundImage: groupGradient(name) } : undefined}
                onClick={() => { setActive(conv.id); setSidebarMode('group', conv.id); }}
                aria-label={name}
              >
                {group?.avatar
                  ? <img src={group.avatar} alt="" className="guild-sidebar__avatar-img" />
                  : <span className="guild-sidebar__initial">{initial}</span>
                }
                {conv.unread > 0 && (
                  <span className="guild-sidebar__badge">{conv.unread > 99 ? '99+' : conv.unread}</span>
                )}
                {!active && conv.unread > 0 && (
                  <span className="guild-sidebar__pip" />
                )}
              </button>
              {active && <span className="guild-sidebar__active-pill" />}
            </div>
          );
        })}

        {/* ── Create Group ──────────────────────── */}
        <div className="guild-sidebar__tooltip-wrap" data-tooltip="Create Group">
          <button
            className="guild-sidebar__icon guild-sidebar__add"
            onClick={() => setShowCreateGroup(true)}
            aria-label="Create Group"
          >
            <Plus size={20} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {showCreateGroup && <CreateGroupModal onClose={() => setShowCreateGroup(false)} />}
    </nav>
  );
}
