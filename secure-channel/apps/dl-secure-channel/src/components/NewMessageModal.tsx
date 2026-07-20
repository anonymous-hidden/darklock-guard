/* ──────────────────────────────────────────────────────────
 *  NewMessageModal — look up users by username, start a DM
 * ────────────────────────────────────────────────────────── */

import React, { useState, useRef, useEffect } from 'react';
import { Modal, Input, Button, Avatar, Badge } from './Shared';
import { Search, Send, User, Shield, AtSign, Check } from './Icons';
import { useChatStore, type UIContact } from '../stores/chatStore';
import { useFriendStore } from '../stores/friendStore';
import { useAuthStore } from '../stores/authStore';
import * as ws from '../net/wsClient';
import './NewMessageModal.css';

interface NewMessageModalProps {
  open: boolean;
  onClose: () => void;
}

export function NewMessageModal({ open, onClose }: NewMessageModalProps) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<UIContact[]>([]);
  const [selectedUser, setSelectedUser] = useState<UIContact | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [sendingRequest, setSendingRequest] = useState(false);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const contacts = useChatStore(s => s.contacts);
  const conversations = useChatStore(s => s.conversations);
  const setActive = useChatStore(s => s.setActiveConversation);
  const addContact = useChatStore(s => s.addContact);
  const addConversation = useChatStore(s => s.addConversation);
  const userId = useAuthStore(s => s.userId);
  const displayName = useAuthStore(s => s.displayName);
  const sessionToken = useAuthStore(s => s.sessionToken);
  const friends = useFriendStore(s => s.friends);
  const addFriendStore = useFriendStore(s => s.addFriend);
  const sendFriendRequest = useFriendStore(s => s.sendRequest);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelectedUser(null);
      setHasSearched(false);
      setSentTo(new Set());
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setHasSearched(true);

    const q = query.trim().replace(/^@/, '');
    const qLow = q.toLowerCase();

    const mergeResults = (remote: UIContact[]) => {
      const map = new Map<string, UIContact>();
      [...remote].forEach((u) => {
        if (!u || u.id === userId) return;
        map.set(u.id, map.has(u.id) ? { ...map.get(u.id)!, ...u } : u);
      });
      setResults(Array.from(map.values()));
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
      // Fallback: search local contacts only
      const localContactResults = Object.values(contacts).filter(
          (c) =>
            c.id !== userId &&
            (c.displayName?.toLowerCase().includes(qLow) || c.id.toLowerCase().includes(qLow))
        );
      mergeResults(localContactResults);
    } finally {
      setSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const isFriend = (contactId: string) =>
    friends.some(f => f.userId === contactId);

  const handleSendRequest = async (contact: UIContact) => {
    if (!userId) return;
    setSendingRequest(true);

    try {
      const result = await sendFriendRequest(userId, contact.id);
      if (result.status === 'sent' || result.status === 'already_sent') {
        setSentTo(prev => new Set(prev).add(contact.id));
        // Notify via WS so recipient gets it in real-time
        void ws.sendFriendRequest(contact.id, result.requestId, displayName ?? userId);
      } else if (result.status === 'accepted' || result.status === 'already_friends') {
        // Mutual auto-accept or already friends — show confirmation but don't auto-open DM
        setSentTo(prev => new Set(prev).add(contact.id));
      }
    } catch { /* ignore */ }
    setSendingRequest(false);
  };

  const handleOpenDM = (contact: UIContact) => {
    if (!userId) return;

    // For existing friends, open or create the DM
    const convId = [userId, contact.id].sort().join(':');
    const existing = conversations[convId];
    if (existing) {
      setActive(existing.id);
    } else {
      const addContact = useChatStore.getState().addContact;
      const addConversation = useChatStore.getState().addConversation;
      if (!contacts[contact.id]) addContact({
        ...contact,
        identityKey: contact.identityKey || '',
        trustLevel: contact.trustLevel || 'unverified',
        addedAt: contact.addedAt || Date.now(),
      });
      addConversation({
        id: convId,
        type: 'dm',
        members: [userId, contact.id],
        createdAt: Date.now(),
        unreadCount: 0,
      });
      setActive(convId);
      // Notify other side so they also create the conversation
      void ws.sendOpenDm(contact.id, displayName ?? userId);
    }
    onClose();
  };

  const handleAction = (contact: UIContact) => {
    if (isFriend(contact.id)) {
      handleOpenDM(contact);
    } else {
      handleSendRequest(contact);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Message" width={480}>
      <div className="new-msg-modal">
        {/* ── Search bar ──────────────────────── */}
        <div className="new-msg-modal__search">
          <Input
            ref={inputRef}
            placeholder="Search by username..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            icon={<AtSign size={14} />}
            rightIcon={
              <button className="new-msg-modal__search-btn" onClick={handleSearch} aria-label="Search">
                <Search size={14} />
              </button>
            }
          />
        </div>

        {/* ── Results ─────────────────────────── */}
        <div className="new-msg-modal__results">
          {searching && (
            <div className="new-msg-modal__searching">
              <div className="new-msg-modal__searching-dot" />
              <div className="new-msg-modal__searching-dot" />
              <div className="new-msg-modal__searching-dot" />
              <span>Searching...</span>
            </div>
          )}

          {!searching && hasSearched && results.length === 0 && (
            <div className="new-msg-modal__empty">
              <User size={32} />
              <p>No users found matching &quot;{query}&quot;</p>
              <span>Make sure you have the correct username</span>
            </div>
          )}

          {!searching && results.length > 0 && (
            <div className="new-msg-modal__list">
              {results.map((contact) => (
                <button
                  key={contact.id}
                  className={`new-msg-modal__user ${selectedUser?.id === contact.id ? 'new-msg-modal__user--selected' : ''}`}
                  onClick={() => setSelectedUser(contact)}
                  onDoubleClick={() => handleAction(contact)}
                >
                  <Avatar
                    name={contact.displayName ?? contact.id}
                    size={40}
                    online={contact.online}
                  />
                  <div className="new-msg-modal__user-info">
                    <span className="new-msg-modal__user-name">
                      {contact.displayName ?? contact.id}
                    </span>
                    <span className="new-msg-modal__user-id">@{contact.id.slice(0, 20)}</span>
                  </div>
                  <div className="new-msg-modal__user-badges">
                    {contact.trustLevel === 'verified' && (
                      <Badge variant="success" icon={<Shield size={10} />}>Verified</Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {!searching && !hasSearched && (
            <div className="new-msg-modal__hint">
              <Shield size={24} />
              <p>Search for a user by their username to start an encrypted conversation.</p>
              <span>Direct messages use encryption when a secure session is available</span>
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────── */}
        {selectedUser && (
          <div className="new-msg-modal__footer">
            <div className="new-msg-modal__selected">
              <Avatar name={selectedUser.displayName ?? selectedUser.id} size={24} />
              <span>{selectedUser.displayName ?? selectedUser.id}</span>
            </div>
            {sentTo.has(selectedUser.id) ? (
              <Button variant="secondary" size="sm" disabled>
                <Check size={14} /> Request Sent
              </Button>
            ) : isFriend(selectedUser.id) ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleOpenDM(selectedUser)}
              >
                <Send size={14} /> Message
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                className="new-msg-modal__friend-btn"
                onClick={() => handleSendRequest(selectedUser)}
                disabled={sendingRequest}
              >
                <User size={14} /> {sendingRequest ? 'Sending…' : 'Add Friend'}
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
