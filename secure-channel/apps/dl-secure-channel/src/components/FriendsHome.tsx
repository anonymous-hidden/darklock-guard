/* ──────────────────────────────────────────────────────────
 *  FriendsHome — Discord-style home screen with friends list,
 *  online status, pending requests, and add friend.
 * ────────────────────────────────────────────────────────── */

import { useState, useEffect, useRef } from 'react';
import { useFriendStore, type Friend } from '../stores/friendStore';
import { useChatStore, type UIContact } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { Avatar, Button } from './Shared';
import { Users, User, Check, X, Search, MessageCircle, AtSign } from './Icons';
import * as ws from '../net/wsClient';
import './FriendsHome.css';

type Tab = 'online' | 'all' | 'pending' | 'add';

export function FriendsHome() {
  const [tab, setTab] = useState<Tab>('online');
  const userId = useAuthStore(s => s.userId);
  const displayName = useAuthStore(s => s.displayName);
  const sessionToken = useAuthStore(s => s.sessionToken);
  const friends = useFriendStore((s) => (Array.isArray(s.friends) ? s.friends : []));
  const incoming = useFriendStore((s) => (Array.isArray(s.incoming) ? s.incoming : []));
  const outgoing = useFriendStore((s) => (Array.isArray(s.outgoing) ? s.outgoing : []));
  const fetchFriends = useFriendStore(s => s.fetchFriends);
  const fetchIncoming = useFriendStore(s => s.fetchIncoming);
  const fetchOutgoing = useFriendStore(s => s.fetchOutgoing);
  const acceptReq = useFriendStore(s => s.acceptRequest);
  const rejectReq = useFriendStore(s => s.rejectRequest);
  const removeIncoming = useFriendStore(s => s.removeIncoming);
  const addFriendStore = useFriendStore(s => s.addFriend);
  const sendFriendRequest = useFriendStore(s => s.sendRequest);

  const contacts = useChatStore((s) => s.contacts ?? {});
  const conversations = useChatStore((s) => s.conversations ?? {});
  const addContact = useChatStore(s => s.addContact);
  const addConversation = useChatStore(s => s.addConversation);
  const setActive = useChatStore(s => s.setActiveConversation);
  const remoteProfiles = useChatStore((s) => s.remoteProfiles ?? {});

  const [searchQuery, setSearchQuery] = useState('');
  const [addQuery, setAddQuery] = useState('');
  const [addSearching, setAddSearching] = useState(false);
  const [addResults, setAddResults] = useState<UIContact[]>([]);
  const [addHasSearched, setAddHasSearched] = useState(false);
  const [addSending, setAddSending] = useState(false);
  const [addSentTo, setAddSentTo] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (userId && sessionToken) {
      fetchFriends(userId);
      fetchIncoming(userId);
      fetchOutgoing(userId);
    }
  }, [userId, sessionToken]);

  useEffect(() => {
    if (tab === 'add') {
      setAddQuery('');
      setAddResults([]);
      setAddHasSearched(false);
      setAddSentTo(new Set());
      setTimeout(() => addInputRef.current?.focus(), 100);
    }
  }, [tab]);

  // ── Helpers ──────────────────────────
  const isOnline = (friendUserId: string) => contacts[friendUserId]?.online ?? false;

  const onlineFriends = friends.filter(f => isOnline(f.userId));
  const allFriends = friends;

  const filteredFriends = (list: Friend[]) => {
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(f =>
      f.displayName.toLowerCase().includes(q) || f.userId.toLowerCase().includes(q)
    );
  };

  // ── Friend Actions ───────────────────
  const handleMessage = (friend: Friend) => {
    if (!userId) return;
    const convId = [userId, friend.userId].sort().join(':');
    const existing = conversations[convId];
    if (existing) {
      setActive(existing.id);
    } else {
      if (!contacts[friend.userId]) {
        addContact({
          id: friend.userId,
          displayName: friend.displayName,
          identityKey: '',
          trustLevel: 'unverified',
          addedAt: Date.now(),
        });
      }
      addConversation({
        id: convId,
        type: 'dm',
        members: [userId, friend.userId],
        createdAt: Date.now(),
        unreadCount: 0,
      });
      setActive(convId);
      void ws.sendOpenDm(friend.userId, displayName ?? userId);
    }
  };

  const handleAccept = async (reqId: string, fromUser: string, fromName: string) => {
    if (!userId) return;
    setBusyId(reqId);
    const result = await acceptReq(reqId, userId);
    if (result) {
      removeIncoming(reqId);
      addFriendStore({ userId: fromUser, displayName: fromName });
      addContact({
        id: fromUser, displayName: fromName, identityKey: '',
        trustLevel: 'unverified', addedAt: Date.now(),
      });
      const convId = [userId, fromUser].sort().join(':');
      if (!conversations[convId]) {
        addConversation({
          id: convId, type: 'dm', members: [userId, fromUser],
          createdAt: Date.now(), unreadCount: 0,
        });
      }
      void ws.sendFriendAccept(fromUser, displayName ?? userId);
    }
    setBusyId(null);
  };

  const handleReject = async (reqId: string) => {
    if (!userId) return;
    setBusyId(reqId);
    await rejectReq(reqId, userId);
    removeIncoming(reqId);
    setBusyId(null);
  };

  // ── Add Friend Search ────────────────
  const handleAddSearch = async () => {
    if (!addQuery.trim()) return;
    setAddSearching(true);
    setAddHasSearched(true);
    setAddError(null);
    const q = addQuery.trim().replace(/^@/, '');
    const qLow = q.toLowerCase();

    const mergeResults = (remote: UIContact[]) => {
      const map = new Map<string, UIContact>();
      [...remote].forEach((u) => {
        if (!u || u.id === userId) return;
        map.set(u.id, map.has(u.id) ? { ...map.get(u.id)!, ...u } : u);
      });
      const merged = Array.from(map.values());
      setAddResults(merged);
      if (merged.length > 0) void ws.requestProfiles(merged.map(r => r.id));
    };

    try {
      const idsUrl = import.meta.env.VITE_IDS_URL ?? 'http://localhost:4100';
      const res = await fetch(`${idsUrl}/users/search?q=${encodeURIComponent(q)}`, {
        headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
      });
      if (!res.ok) {
        mergeResults([]);
        return;
      }
      const data = await res.json();
      const remoteResults: UIContact[] = (data.users ?? [])
        .filter((u: { userId: string }) => u.userId !== userId)
        .map((u: { userId: string; displayName: string }) => ({
          id: u.userId,
          displayName: u.displayName,
          identityKey: '',
          trustLevel: 'unverified' as const,
          addedAt: Date.now(),
          online: !!(contacts[u.userId]?.online),
        }));
      mergeResults(remoteResults);
    } catch {
      mergeResults([]);
    } finally {
      setAddSearching(false);
    }
  };

  const handleSendRequest = async (contact: UIContact) => {
    if (!userId) return;
    setAddSending(true);
    setAddError(null);

    try {
      const result = await sendFriendRequest(userId, contact.id);
      if (result.status === 'sent' || result.status === 'already_sent') {
        setAddSentTo(prev => new Set(prev).add(contact.id));
        void ws.sendFriendRequest(contact.id, result.requestId, displayName ?? userId);
      } else if (result.status === 'accepted') {
        // Mutual accept — the other user had a pending request to us; both become friends now
        addFriendStore({ userId: contact.id, displayName: contact.displayName });
        if (!contacts[contact.id]) addContact(contact);
        const convId = [userId, contact.id].sort().join(':');
        if (!conversations[convId]) {
          addConversation({ id: convId, type: 'dm', members: [userId, contact.id], createdAt: Date.now(), unreadCount: 0 });
        }
        // Notify the other side so their app also creates the conversation
        void ws.sendFriendAccept(contact.id, displayName ?? userId);
        setAddSentTo(prev => new Set(prev).add(contact.id));
      } else if (result.status === 'already_friends') {
        setAddSentTo(prev => new Set(prev).add(contact.id));
      } else {
        setAddError('Could not send friend request — make sure the servers are running.');
      }
    } catch {
      setAddError('Could not send friend request — server may be offline.');
    }
    setAddSending(false);
  };

  const isFriend = (id: string) => friends.some(f => f.userId === id);

  const pendingCount = incoming.length + outgoing.length;

  // ── Render ───────────────────────────
  return (
    <div className="friends-home">
      {/* ── Header / Tab Bar ─────────── */}
      <div className="friends-home__header">
        <div className="friends-home__title">
          <Users size={20} />
          <span>Friends</span>
        </div>
        <div className="friends-home__tabs">
          <button
            className={`friends-home__tab ${tab === 'online' ? 'friends-home__tab--active' : ''}`}
            onClick={() => setTab('online')}
          >
            Online
          </button>
          <button
            className={`friends-home__tab ${tab === 'all' ? 'friends-home__tab--active' : ''}`}
            onClick={() => setTab('all')}
          >
            All
          </button>
          <button
            className={`friends-home__tab ${tab === 'pending' ? 'friends-home__tab--active' : ''}`}
            onClick={() => setTab('pending')}
          >
            Pending
            {pendingCount > 0 && <span className="friends-home__tab-badge">{pendingCount}</span>}
          </button>
          <button
            className={`friends-home__tab friends-home__tab--add ${tab === 'add' ? 'friends-home__tab--active' : ''}`}
            onClick={() => setTab('add')}
          >
            Add Friend
          </button>
        </div>
      </div>

      {/* ── Content ──────────────────── */}
      <div className="friends-home__content">
        {/* ── Online / All tabs ──── */}
        {(tab === 'online' || tab === 'all') && (
          <>
            <div className="friends-home__search">
              <Search size={14} />
              <input
                placeholder="Search"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="friends-home__section-label">
              {tab === 'online'
                ? `Online — ${filteredFriends(onlineFriends).length}`
                : `All Friends — ${filteredFriends(allFriends).length}`}
            </div>
            <div className="friends-home__list">
              {filteredFriends(tab === 'online' ? onlineFriends : allFriends).map(friend => (
                <div key={friend.userId} className="friends-home__item">
                  <Avatar
                    name={friend.displayName}
                    src={remoteProfiles[friend.userId]?.avatar ?? undefined}
                    size={40}
                    online={isOnline(friend.userId)}
                  />
                  <div className="friends-home__item-info">
                    <span className="friends-home__item-name">{friend.displayName}</span>
                    <span className="friends-home__item-status">
                      {isOnline(friend.userId) ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <div className="friends-home__item-actions">
                    <button
                      className="friends-home__icon-btn"
                      title="Message"
                      onClick={() => handleMessage(friend)}
                    >
                      <MessageCircle size={18} />
                    </button>
                  </div>
                </div>
              ))}
              {filteredFriends(tab === 'online' ? onlineFriends : allFriends).length === 0 && (
                <div className="friends-home__empty">
                  <Users size={40} />
                  <p>{tab === 'online' ? 'No friends online right now.' : 'No friends yet.'}</p>
                  <Button variant="primary" onClick={() => setTab('add')}>
                    Add a Friend
                  </Button>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Pending tab ────────── */}
        {tab === 'pending' && (
          <div className="friends-home__list">
            {incoming.length > 0 && (
              <>
                <div className="friends-home__section-label">
                  Incoming — {incoming.length}
                </div>
                {incoming.map(req => (
                  <div key={req.id} className="friends-home__item">
                    <Avatar name={req.displayName} size={40} />
                    <div className="friends-home__item-info">
                      <span className="friends-home__item-name">{req.displayName}</span>
                      <span className="friends-home__item-status">Incoming Friend Request</span>
                    </div>
                    <div className="friends-home__item-actions">
                      <button
                        className="friends-home__icon-btn friends-home__icon-btn--accept"
                        title="Accept"
                        onClick={() => handleAccept(req.id, req.fromUser, req.displayName)}
                        disabled={busyId === req.id}
                      >
                        <Check size={18} />
                      </button>
                      <button
                        className="friends-home__icon-btn friends-home__icon-btn--reject"
                        title="Decline"
                        onClick={() => handleReject(req.id)}
                        disabled={busyId === req.id}
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
            {outgoing.length > 0 && (
              <>
                <div className="friends-home__section-label">
                  Outgoing — {outgoing.length}
                </div>
                {outgoing.map(req => (
                  <div key={req.id} className="friends-home__item">
                    <Avatar name={req.displayName} size={40} />
                    <div className="friends-home__item-info">
                      <span className="friends-home__item-name">{req.displayName}</span>
                      <span className="friends-home__item-status">Outgoing Friend Request</span>
                    </div>
                    <div className="friends-home__item-actions">
                      <span className="friends-home__pending-label">Pending</span>
                    </div>
                  </div>
                ))}
              </>
            )}
            {incoming.length === 0 && outgoing.length === 0 && (
              <div className="friends-home__empty">
                <User size={40} />
                <p>No pending friend requests.</p>
              </div>
            )}
          </div>
        )}

        {/* ── Add Friend tab ─────── */}
        {tab === 'add' && (
          <div className="friends-home__add">
            <div className="friends-home__add-header">
              <h3>Add Friend</h3>
              <p>You can add friends by their username.</p>
            </div>
            <div className="friends-home__add-input">
              <AtSign size={14} />
              <input
                ref={addInputRef}
                placeholder="Enter a username"
                value={addQuery}
                onChange={e => setAddQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddSearch()}
              />
              <Button
                variant="primary"
                size="sm"
                onClick={handleAddSearch}
                disabled={!addQuery.trim() || addSearching}
              >
                {addSearching ? 'Searching...' : 'Search'}
              </Button>
            </div>
            {addError && (
              <div className="friends-home__add-error">
                {addError}
              </div>
            )}
            <div className="friends-home__add-results">
              {addSearching && (
                <div className="friends-home__empty">
                  <p>Searching...</p>
                </div>
              )}
              {!addSearching && addHasSearched && addResults.length === 0 && (
                <div className="friends-home__empty">
                  <User size={40} />
                  <p>No users found matching "{addQuery}"</p>
                </div>
              )}
              {!addSearching && addResults.map(contact => (
                <div key={contact.id} className="friends-home__item">
                  <Avatar
                    name={contact.displayName ?? contact.id}
                    src={remoteProfiles[contact.id]?.avatar ?? undefined}
                    size={40}
                    online={contact.online}
                  />
                  <div className="friends-home__item-info">
                    <span className="friends-home__item-name">
                      {contact.displayName ?? contact.id}
                    </span>
                    <span className="friends-home__item-status">@{contact.id.slice(0, 24)}</span>
                  </div>
                  <div className="friends-home__item-actions">
                    {addSentTo.has(contact.id) ? (
                      <Button variant="secondary" size="sm" disabled>
                        <Check size={14} /> Sent
                      </Button>
                    ) : isFriend(contact.id) ? (
                      <Button variant="secondary" size="sm" disabled>
                        Already Friends
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        className="friends-home__friend-btn"
                        onClick={() => handleSendRequest(contact)}
                        disabled={addSending}
                      >
                        Send Request
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
