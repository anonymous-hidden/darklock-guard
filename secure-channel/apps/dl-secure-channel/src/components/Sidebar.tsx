import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { useProfileStore, PRESENCE_COLORS } from '../stores/profileStore';
import { useTagStore, TAG_MAP } from '../stores/tagStore';
import { useConnectionStore } from '../stores/connectionStore';
import { canAccessAdminPanel } from '../utils/adminAccess';
import { NAMEPLATE_MAP } from './ProfileEditor';
import {
  Search, Settings, Plus, Users, MessageCircle, Lock,
  User, Wifi, WifiOff, Shield, ShieldCheck, Bell, BellOff,
  Trash, Eye, AtSign, Check, ArrowLeft, Globe, Refresh,
} from './Icons';
import { Avatar, Badge, Input, ConfirmDialog } from './Shared';
import { AvatarWithStatus } from './AvatarWithStatus';
import ridgelineScImg from '../assets/ridgeline-sc.png';
import { NewMessageModal } from './NewMessageModal';
import { FriendRequestsPanel } from './FriendRequestsPanel';
import { ProfilePopup } from './ProfilePopup';
import { getNameFontStyle } from './ProfileEditor';
import { CreateGroupModal } from './GroupManagement';
import type { UIConversation } from '../stores/chatStore';
import { resetSession } from '../crypto/e2eeSessions';
import './Sidebar.css';

interface CtxMenu {
  x: number;
  y: number;
  convId: string;
  otherId: string;   // empty string for group conversations
}

interface UserCardState {
  userId: string;
  name: string;
}

interface NicknameState {
  userId: string;
  current: string;
}

export function Sidebar() {
  const [query, setQuery] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const [showNewMsg, setShowNewMsg] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [userCard, setUserCard] = useState<UserCardState | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [nicknameModal, setNicknameModal] = useState<NicknameState | null>(null);
  const [nicknameInput, setNicknameInput] = useState('');
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState<{ convId: string; name: string } | null>(null);
  const [leaveGroupConfirm, setLeaveGroupConfirm] = useState<{ convId: string; name: string } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  const nicknameInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('dl-sidebar-width');
    return saved ? Math.max(220, Math.min(500, parseInt(saved, 10))) : 320;
  });
  const [isResizing, setIsResizing] = useState(false);

  const conversations = useChatStore((s) => s.conversations ?? {});
  const groups = useChatStore((s) => s.groups ?? {});
  const contacts = useChatStore((s) => s.contacts ?? {});
  const nicknames = useChatStore((s) => s.nicknames ?? {});
  const activeConversation = useChatStore(s => s.activeConversation);
  const activeGroupId = useChatStore(s => s.activeGroupId);
  const sidebarMode = useChatStore(s => s.sidebarMode);
  const setNickname = useChatStore(s => s.setNickname);
  const clearNickname = useChatStore(s => s.clearNickname);
  const removeContact = useChatStore(s => s.removeContact);
  const removeConversation = useChatStore(s => s.removeConversation);
  const deleteGroup = useChatStore(s => s.deleteGroup);
  const markRead = useChatStore(s => s.markRead);
  const toggleMute = useChatStore(s => s.toggleMute);
  const setActive = useChatStore(s => s.setActiveConversation);
  const setSidebarMode = useChatStore(s => s.setSidebarMode);
  const setScreen = useAuthStore(s => s.setScreen);
  const userTagMap = useTagStore(s => s.userTags);
  const userId = useAuthStore(s => s.userId);
  const systemRole = useAuthStore(s => s.systemRole);
  const canOpenAdmin = canAccessAdminPanel(userId, systemRole);

  const displayName = useAuthStore(s => s.displayName);
  const profile = useProfileStore();
  const connected = useConnectionStore(s => s.status === 'connected');
  const remoteProfiles = useChatStore((s) => s.remoteProfiles ?? {});

  const getConversationMembers = useCallback((conv: UIConversation): string[] => {
    if (Array.isArray(conv.participantIds)) return conv.participantIds;
    const legacy = (conv as unknown as { members?: string[] }).members;
    return Array.isArray(legacy) ? legacy : [];
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const list = Object.values(conversations);
    if (!q) return list.sort((a, b) => b.lastActivity - a.lastActivity);
    return list
      .filter(c => {
        if (c.type === 'dm') {
          const otherId = getConversationMembers(c).find((id) => id !== userId) ?? '';
          const contact = contacts[otherId];
          return contact?.displayName?.toLowerCase().includes(q);
        }
        const g = groups[c.id];
        return g?.name?.toLowerCase().includes(q);
      })
      .sort((a, b) => b.lastActivity - a.lastActivity);
  }, [conversations, groups, contacts, userId, query, getConversationMembers]);

  const dmConversations = useMemo(
    () => filtered.filter(c => c.type === 'dm'),
    [filtered],
  );

  const groupConversations = useMemo(
    () => filtered.filter(c => c.type === 'group'),
    [filtered],
  );

  // Tab is driven by sidebarMode so it stays in sync with GroupChannelSidebar
  const currentTab = sidebarMode === 'group' ? 'groups' : 'direct';
  const displayList = currentTab === 'groups' ? groupConversations : dmConversations;

  const getConvName = useCallback(
    (conv: UIConversation) => {
      if (conv.type === 'group') {
        return groups[conv.id]?.name ?? 'Group';
      }
      const otherId = getConversationMembers(conv).find((id) => id !== userId) ?? '';
      // Prefer nickname if set
      if (nicknames[otherId]) return nicknames[otherId];
      return contacts[otherId]?.displayName ?? otherId.slice(0, 8);
    },
    [groups, contacts, nicknames, userId, getConversationMembers],
  );

  const getConvOnline = useCallback(
    (conv: UIConversation) => {
      if (conv.type === 'group') return false;
      const otherId = getConversationMembers(conv).find((id) => id !== userId) ?? '';
      return contacts[otherId]?.online ?? false;
    },
    [contacts, userId, getConversationMembers],
  );

  const formatTime = (ts: number) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const diff = now.getTime() - d.getTime();
    if (diff < 7 * 86400000) {
      return d.toLocaleDateString([], { weekday: 'short' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // ── Context menu helpers ───────────────────────────────
  const openCtxMenu = useCallback((e: React.MouseEvent, conv: UIConversation) => {
    e.preventDefault();
    e.stopPropagation();
    const otherId = conv.type === 'dm'
      ? (getConversationMembers(conv).find((id) => id !== userId) ?? '')
      : '';
    setCtxMenu({ x: e.clientX, y: e.clientY, convId: conv.id, otherId });
  }, [userId, getConversationMembers]);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  // Close context menu on outside click/touch or Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) closeCtxMenu();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeCtxMenu(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu, closeCtxMenu]);

  // Focus nickname input when modal opens
  useEffect(() => {
    if (nicknameModal) {
      setNicknameInput(nicknameModal.current);
      setTimeout(() => nicknameInputRef.current?.select(), 50);
    }
  }, [nicknameModal]);

  // Sidebar resize handler
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(220, Math.min(500, startWidth + delta));
      setSidebarWidth(newWidth);
    };
    const onUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Persist
      const el = sidebarRef.current;
      if (el) localStorage.setItem('dl-sidebar-width', String(el.offsetWidth));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  function handleCtxShowProfile() {
    if (!ctxMenu) return;
    const name = getConvName(conversations[ctxMenu.convId]);
    setUserCard({ userId: ctxMenu.otherId, name });
    closeCtxMenu();
  }

  function handleCtxNickname() {
    if (!ctxMenu || !ctxMenu.otherId) return;
    setNicknameModal({ userId: ctxMenu.otherId, current: nicknames[ctxMenu.otherId] ?? '' });
    closeCtxMenu();
  }

  function handleCtxMute() {
    if (!ctxMenu) return;
    toggleMute(ctxMenu.convId);
    closeCtxMenu();
  }

  function handleCtxMarkRead() {
    if (!ctxMenu) return;
    markRead(ctxMenu.convId);
    closeCtxMenu();
  }

  function handleCtxResetSession() {
    if (!ctxMenu || !ctxMenu.otherId) return;
    resetSession(ctxMenu.otherId);
    closeCtxMenu();
  }

  function handleCtxRemove() {
    if (!ctxMenu) return;
    removeContact(ctxMenu.otherId);
    removeConversation(ctxMenu.convId);
    closeCtxMenu();
  }

  function handleCtxLeaveGroup() {
    if (!ctxMenu) return;
    const name = groups[ctxMenu.convId]?.name ?? 'this group';
    setLeaveGroupConfirm({ convId: ctxMenu.convId, name });
    closeCtxMenu();
  }

  function handleCtxDeleteGroup() {
    if (!ctxMenu) return;
    const name = groups[ctxMenu.convId]?.name ?? 'this group';
    setDeleteGroupConfirm({ convId: ctxMenu.convId, name });
    closeCtxMenu();
  }

  function handleNicknameSave() {
    if (!nicknameModal) return;
    const val = nicknameInput.trim();
    if (val) setNickname(nicknameModal.userId, val);
    else clearNickname(nicknameModal.userId);
    setNicknameModal(null);
  }

  const isMobileViewport =
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

  const openGroupConversation = (groupId: string) => {
    setSidebarMode('group', groupId);
    // Discord-like mobile flow: open channel list first, then chat.
    if (isMobileViewport) {
      setActive(null);
      return;
    }
    setActive(groupId);
  };

  return (
    <div className="sidebar-wrapper">
    <aside className={`sidebar sidebar--${currentTab}`} ref={sidebarRef} style={{ width: sidebarWidth }}>
      {/* ── Search ─────────────────────────────────── */}
      <div className="sidebar-ridgeline-text">RIDGELINE</div>
      <div className="sidebar-search">
        <Input
          placeholder={currentTab === 'groups' ? 'Search groups…' : 'Search conversations…'}
          value={query}
          onChange={e => setQuery(e.target.value)}
          icon={<Search size={16} />}
        />
      </div>

      {/* ── Tabs (desktop only; mobile uses bottom nav) ───────────────────── */}
      {!isMobileViewport && (
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab ${currentTab === 'direct' ? 'sidebar-tab--active' : ''}`}
            onClick={() => { setSidebarMode('dm'); setActive(null); }}
          >
            <MessageCircle size={16} />
            Direct
            {dmConversations.some(c => c.unread > 0) && (
              <span className="sidebar-tab__badge" />
            )}
          </button>
          <button
            className={`sidebar-tab ${currentTab === 'groups' ? 'sidebar-tab--active' : ''}`}
            onClick={() => {
              if (!isMobileViewport && activeGroupId) {
                setSidebarMode('group', activeGroupId);
                setActive(activeGroupId);
              } else {
                setSidebarMode('group');
                setActive(null);
              }
            }}
          >
            <Users size={16} />
            Groups
            {groupConversations.some(c => c.unread > 0) && (
              <span className="sidebar-tab__badge" />
            )}
          </button>
        </div>
      )}

      {/* ── New conversation / Create group button ────── */}
      <div className="sidebar-new-section">
        {currentTab === 'groups' ? (
          <button className="sidebar-new-btn" onClick={() => setCreateGroupOpen(true)}>
            <Plus size={18} />
            <span>New Server</span>
          </button>
        ) : (
          <button className="sidebar-new-btn" onClick={() => setShowNewMsg(true)}>
            <Plus size={18} />
            <span>New Message</span>
          </button>
        )}
        <button className="sidebar-shop-btn" onClick={() => { setActive(null); setScreen('shop'); }}>
          <Globe size={14} />
          <span>Open Shop</span>
        </button>
      </div>

      {/* ── Friend requests ────────────────────────── */}
      {currentTab === 'direct' && <FriendRequestsPanel />}

      <div className="sidebar-mobile-section-title">
        {currentTab === 'groups' ? 'Servers' : 'Direct Messages'}
      </div>

      {/* ── Conversation list ──────────────────────── */}
      <div className="sidebar-list">
        {displayList.length === 0 && (
          <div className="sidebar-empty">
            {query ? 'No results' : 'No conversations yet'}
          </div>
        )}

        {displayList.map(conv => {
          const name = getConvName(conv);
          const online = getConvOnline(conv);
          const isGroupActive = conv.type === 'group' && conv.id === activeGroupId;
          const active = conv.type === 'group' ? isGroupActive : conv.id === activeConversation;
          const otherId = conv.type === 'dm'
            ? (getConversationMembers(conv).find((id) => id !== userId) ?? '')
            : '';
          const remoteProfile = otherId ? remoteProfiles[otherId] : undefined;
          const groupInfo = conv.type === 'group' ? groups[conv.id] : null;
          const groupMembers = groupInfo?.members?.length ?? 0;
          const groupChannels = groupInfo?.channels?.length ?? 0;
          const dmBannerStyle = conv.type === 'dm' && remoteProfile
            ? (remoteProfile.banner
                ? { backgroundImage: `url(${remoteProfile.banner})` }
                : remoteProfile.nameplate && NAMEPLATE_MAP[remoteProfile.nameplate]
                  ? { background: NAMEPLATE_MAP[remoteProfile.nameplate].gradient }
                  : remoteProfile.accentColor
                    ? {
                        background: `linear-gradient(${remoteProfile.gradientAngle ?? 135}deg, ${remoteProfile.accentColor}, ${remoteProfile.accentColor2 || `${remoteProfile.accentColor}66`})`,
                      }
                    : null)
            : null;

          return (
            <button
              key={conv.id}
              className={`sidebar-item ${active ? 'sidebar-item--active' : ''}${conv.type === 'group' ? ' sidebar-item--group-conv' : ' sidebar-item--dm-conv'}`}
              onClick={() => {
                if (conv.type === 'group') {
                  openGroupConversation(conv.id);
                } else {
                  setActive(conv.id);
                }
              }}
              onContextMenu={e => openCtxMenu(e, conv)}
            >
              {conv.type === 'dm' && dmBannerStyle && (
                <span className="sidebar-item__dm-banner" style={dmBannerStyle} aria-hidden="true" />
              )}

              <div className="sidebar-item__avatar">
                {conv.type === 'group'
                  ? <div className="sidebar-item__group-icon"><Users size={18} /></div>
                  : <AvatarWithStatus
                      name={remoteProfile?.displayName || name}
                      avatarUrl={remoteProfile?.avatar ?? undefined}
                      statusText={remoteProfile?.statusText}
                      statusEmoji={remoteProfile?.statusEmoji}
                      size={40}
                      online={online}
                      statusColor={online ? PRESENCE_COLORS[remoteProfile?.presence ?? 'online'] : undefined}
                    />
                }
              </div>

              <div className="sidebar-item__body">
                <div className="sidebar-item__top">
                  <span className="sidebar-item__name">{name}</span>
                  {conv.type === 'dm' && (
                    <span className="sidebar-item__time">{formatTime(conv.lastActivity)}</span>
                  )}
                </div>
                <div className="sidebar-item__bottom">
                  {conv.type === 'group' ? (
                    <>
                      <span className="sidebar-item__group-meta">
                        <Lock size={12} />
                        {groupChannels} channels · {groupMembers} members
                      </span>
                      <span className="sidebar-item__group-actions">
                        {conv.unread > 0 && (
                          <Badge variant="danger">{conv.unread > 99 ? '99+' : conv.unread}</Badge>
                        )}
                        <span className="sidebar-item__group-arrow" aria-hidden="true">›</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="sidebar-item__preview">
                        {conv.muted && <BellOff size={12} />}
                        {conv.lastMessage ?? '\u00A0'}
                      </span>
                      {conv.unread > 0 && (
                        <Badge variant="danger">{conv.unread > 99 ? '99+' : conv.unread}</Badge>
                      )}
                    </>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Footer: security + profile bar ──────────── */}
      <div className="sidebar-footer">
        <div className="sidebar-footer__security">
          <Shield size={12} />
          <span>Direct-message security</span>
        </div>
      </div>

      <div className="sidebar-profile" onClick={() => setShowProfile(!showProfile)}>
        <div className="sidebar-profile__avatar-wrap">
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
        <div className="sidebar-profile__info">
          <span className="sidebar-profile__name" style={{ color: profile.usernameColor, ...getNameFontStyle(profile.displayNameFont) }}>
            {profile.displayName || displayName || 'User'}
          </span>
          <span className="sidebar-profile__status">
            @{profile.username || userId || 'user'}
          </span>
        </div>
        <button className="sidebar-icon-btn sidebar-icon-btn--admin" onClick={(e) => { e.stopPropagation(); setActive(null); setScreen('admin'); }} title="Admin Panel" style={{ display: canOpenAdmin ? undefined : 'none' }}>
          <ShieldCheck size={20} />
        </button>
        <button className="sidebar-icon-btn" onClick={(e) => { e.stopPropagation(); setActive(null); setScreen('settings'); }}>
          <Settings size={20} />
        </button>
        <ProfilePopup open={showProfile} onClose={() => setShowProfile(false)} />
      </div>

      <NewMessageModal open={showNewMsg} onClose={() => setShowNewMsg(false)} />
      {createGroupOpen && <CreateGroupModal onClose={() => setCreateGroupOpen(false)} />}

      {/* ── Right-click context menu ──────────────── */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="sidebar-ctx"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          role="menu"
        >
          {ctxMenu.otherId && (
            <button className="sidebar-ctx__item" onClick={handleCtxShowProfile}>
              <Eye size={16} /> Show Profile
            </button>
          )}
          {ctxMenu.otherId && (
            <button className="sidebar-ctx__item" onClick={handleCtxNickname}>
              <AtSign size={16} /> {nicknames[ctxMenu.otherId] ? 'Edit Nickname' : 'Add Nickname'}
            </button>
          )}
          <button className="sidebar-ctx__item" onClick={handleCtxMute}>
            {conversations[ctxMenu.convId]?.muted
              ? <><Bell size={16} /> Unmute</>
              : <><BellOff size={16} /> Mute</>}
          </button>
          <button className="sidebar-ctx__item" onClick={handleCtxMarkRead}>
            <Check size={16} /> Mark as Read
          </button>
          {ctxMenu.otherId && (
            <button className="sidebar-ctx__item" onClick={handleCtxResetSession} title="Wipe local ratchet state — next message performs a fresh X3DH key exchange">
              <Refresh size={16} /> Reset Secure Session
            </button>
          )}
          {ctxMenu.otherId && (
            <>
              <div className="sidebar-ctx__divider" />
              <button className="sidebar-ctx__item sidebar-ctx__item--danger" onClick={handleCtxRemove}>
                <Trash size={16} /> Remove Contact
              </button>
            </>
          )}
          {!ctxMenu.otherId && (() => {
            const conv = conversations[ctxMenu.convId];
            const group = groups[ctxMenu.convId];
            const isOwner = group?.createdBy === userId || group?.members.some(m => m.userId === userId && m.role === 'admin');
            return (
              <>
                <div className="sidebar-ctx__divider" />
                <button className="sidebar-ctx__item sidebar-ctx__item--danger" onClick={handleCtxLeaveGroup}>
                  <ArrowLeft size={16} /> Leave Group
                </button>
                {isOwner && (
                  <button className="sidebar-ctx__item sidebar-ctx__item--danger" onClick={handleCtxDeleteGroup}>
                    <Trash size={16} /> Delete Group
                  </button>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* ── User profile card ─────────────────────── */}
      {userCard && (() => {
        const rp = remoteProfiles[userCard.userId];
        const rpName = rp?.displayName || userCard.name;
        const rpOrder = rp?.sectionOrder ?? ['tags', 'status', 'bio', 'links'];
        const rpTagIds = rp?.selectedTags?.length ? rp.selectedTags : (userTagMap[userCard.userId] ?? []);
        const rpTags = rpTagIds.map(id => TAG_MAP[id]).filter(Boolean);
        const rpLinks = rp?.links ?? [];

        const sectionMap: Record<string, React.ReactNode> = {
          tags: rpTags.length > 0 ? (
            <div className="sidebar-usercard__tags">
              {rpTags.map(tag => (
                <span key={tag.id} className="sidebar-usercard__tag"
                  style={{ background: tag.color, color: tag.textColor ?? '#fff' }}>
                  {tag.label}
                </span>
              ))}
            </div>
          ) : null,
          status: (rp?.statusEmoji || rp?.statusText) ? (
            <div className="sidebar-usercard__custom-status">
              {rp?.statusEmoji && <span>{rp.statusEmoji}</span>}
              {rp?.statusText && <span>{rp.statusText}</span>}
            </div>
          ) : null,
          bio: rp?.bio ? (
            <div className="sidebar-usercard__bio-section">
              <h4 className="sidebar-usercard__section-heading">About Me</h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--dl-text-secondary)', margin: 0 }}>{rp.bio}</p>
            </div>
          ) : null,
          links: rpLinks.length > 0 ? (
            <div className="sidebar-usercard__links-section">
              <h4 className="sidebar-usercard__section-heading">Links</h4>
              {rpLinks.map(link => (
                <button key={link.id} className="sidebar-usercard__link-btn"
                  onClick={() => setPendingLink(link.url)}>
                  <Globe size={12} /> {link.label || link.url}
                </button>
              ))}
            </div>
          ) : null,
        };
        const visibleSections = rpOrder.filter((id: string) => sectionMap[id] != null);

        return (
        <div className="sidebar-usercard-overlay" onMouseDown={() => setUserCard(null)}>
          <div className="sidebar-usercard" onMouseDown={e => e.stopPropagation()}>
            {/* Banner */}
            <div className="sidebar-usercard__banner"
              style={rp?.banner
                ? { backgroundImage: `url(${rp.banner})` }
                : rp?.nameplate && NAMEPLATE_MAP[rp.nameplate]
                  ? { background: NAMEPLATE_MAP[rp.nameplate].gradient }
                  : { background: `linear-gradient(${rp?.gradientAngle ?? 135}deg, ${rp?.accentColor ?? '#6366f1'}, ${rp?.accentColor2 || (rp?.accentColor ?? '#6366f1') + '66'})` }
              }
            />
            {/* Avatar + presence */}
            <div className="sidebar-usercard__avatar-ring">
              <Avatar name={rpName} src={rp?.avatar ?? undefined} size={72} />
              {contacts[userCard.userId] && (
                <span className="sidebar-usercard__presence-dot"
                  style={{ background: contacts[userCard.userId].online ? PRESENCE_COLORS[rp?.presence ?? 'online'] : PRESENCE_COLORS.invisible }}
                />
              )}
            </div>
            <button className="sidebar-usercard__close" onClick={() => setUserCard(null)}>&times;</button>
            <div className="sidebar-usercard__body">
              {/* Nameplate banner or accent gradient */}
              <div className="sidebar-usercard__name" style={{ color: rp?.usernameColor }}>{rpName}</div>
              {rp?.username && (
                <div className="sidebar-usercard__id">@{rp.username}</div>
              )}
              {!rp?.username && (
                <div className="sidebar-usercard__id">{contacts[userCard.userId]?.displayName ?? userCard.userId}</div>
              )}
              {rp?.pronouns && <Badge variant="default">{rp.pronouns}</Badge>}

              {/* Reorderable sections */}
              {visibleSections.map((sectionId: string) => (
                <div key={sectionId}>
                  <div className="sidebar-usercard__divider" />
                  {sectionMap[sectionId]}
                </div>
              ))}
            </div>
            {contacts[userCard.userId] && (
              <div className="sidebar-usercard__meta">
                <span className={`sidebar-usercard__status ${contacts[userCard.userId].online ? 'sidebar-usercard__status--online' : ''}`}>
                  {contacts[userCard.userId].online ? 'Online' : 'Offline'}
                </span>
                <span className="sidebar-usercard__trust">
                  Trust: {contacts[userCard.userId].trustLevel}
                </span>
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {/* ── Nickname modal ────────────────────────── */}
      {nicknameModal && (
        <div className="sidebar-usercard-overlay" onMouseDown={() => setNicknameModal(null)}>
          <div className="sidebar-usercard sidebar-nickname-modal" onMouseDown={e => e.stopPropagation()}>
            <div className="sidebar-nickname-modal__title">
              <AtSign size={16} />
              {nicknameModal.current ? 'Edit Nickname' : 'Add Nickname'}
            </div>
            <input
              ref={nicknameInputRef}
              className="sidebar-nickname-modal__input"
              value={nicknameInput}
              onChange={e => setNicknameInput(e.target.value)}
              placeholder="Enter nickname…"
              onKeyDown={e => {
                if (e.key === 'Enter') handleNicknameSave();
                if (e.key === 'Escape') setNicknameModal(null);
              }}
            />
            <div className="sidebar-nickname-modal__actions">
              <button className="sidebar-nickname-modal__save" onClick={handleNicknameSave}>
                <Check size={14} /> Save
              </button>
              {nicknameModal.current && (
                <button
                  className="sidebar-nickname-modal__clear"
                  onClick={() => { clearNickname(nicknameModal.userId); setNicknameModal(null); }}
                >
                  <Trash size={14} /> Clear
                </button>
              )}
              <button className="sidebar-nickname-modal__cancel" onClick={() => setNicknameModal(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── External link warning ─────────────────── */}
      {pendingLink && (
        <div className="sidebar-usercard-overlay" onMouseDown={() => setPendingLink(null)}>
          <div className="sidebar-usercard sidebar-link-warning" onMouseDown={e => e.stopPropagation()} style={{ maxWidth: 380, padding: '1.2rem' }}>
            <div style={{ fontWeight: 600, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: 6 }}>
              ⚠️ External Link
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--dl-text-secondary)', margin: '0 0 0.5rem' }}>
              You are about to open an external link. Only continue if you trust this URL:
            </p>
            <div style={{
              background: 'var(--dl-bg-tertiary)', borderRadius: 6, padding: '0.4rem 0.6rem',
              fontSize: '0.78rem', wordBreak: 'break-all', color: 'var(--dl-accent)', marginBottom: '0.75rem'
            }}>
              {pendingLink}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                style={{ background: 'var(--dl-bg-tertiary)', border: 'none', borderRadius: 6, padding: '0.4rem 1rem', cursor: 'pointer', color: 'var(--dl-text-primary)' }}
                onClick={() => setPendingLink(null)}
              >
                Cancel
              </button>
              <button
                style={{ background: 'var(--dl-accent)', border: 'none', borderRadius: 6, padding: '0.4rem 1rem', cursor: 'pointer', color: '#fff', fontWeight: 600 }}
                onClick={() => {
                  window.open(pendingLink, '_blank', 'noopener,noreferrer');
                  setPendingLink(null);
                }}
              >
                Open Link
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteGroupConfirm}
        title="Delete server?"
        destructive
        confirmLabel="Delete"
        message={
          <>
            Permanently delete <strong>{deleteGroupConfirm?.name}</strong>? All channels, messages and member data stored locally will be erased. This cannot be undone.
          </>
        }
        onConfirm={() => {
          if (deleteGroupConfirm) deleteGroup(deleteGroupConfirm.convId);
          setDeleteGroupConfirm(null);
        }}
        onCancel={() => setDeleteGroupConfirm(null)}
      />

      <ConfirmDialog
        open={!!leaveGroupConfirm}
        title="Leave server?"
        destructive
        confirmLabel="Leave"
        message={
          <>
            Leave <strong>{leaveGroupConfirm?.name}</strong>? You'll need a new invite to rejoin.
          </>
        }
        onConfirm={() => {
          if (leaveGroupConfirm) removeConversation(leaveGroupConfirm.convId);
          setLeaveGroupConfirm(null);
        }}
        onCancel={() => setLeaveGroupConfirm(null)}
      />
    </aside>
    <div
      className={`sidebar-resize-handle ${isResizing ? 'sidebar-resize-handle--active' : ''}`}
      onMouseDown={handleResizeStart}
    />
    </div>
  );
}
