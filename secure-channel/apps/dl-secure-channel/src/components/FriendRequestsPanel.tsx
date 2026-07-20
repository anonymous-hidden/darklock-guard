/* ──────────────────────────────────────────────────────────
 *  FriendRequestsPanel — shows incoming friend requests
 *  in the sidebar area, with accept / reject actions.
 * ────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';
import { useFriendStore } from '../stores/friendStore';
import { useChatStore, type UIContact } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { Avatar, Badge } from './Shared';
import { Check, X, User } from './Icons';
import * as ws from '../net/wsClient';
import './FriendRequestsPanel.css';

export function FriendRequestsPanel() {
  const userId = useAuthStore(s => s.userId);
  const displayName = useAuthStore(s => s.displayName);
  const incoming = useFriendStore((s) => (Array.isArray(s.incoming) ? s.incoming : []));
  const fetchIncoming = useFriendStore(s => s.fetchIncoming);
  const acceptReq = useFriendStore(s => s.acceptRequest);
  const rejectReq = useFriendStore(s => s.rejectRequest);
  const removeIncoming = useFriendStore(s => s.removeIncoming);
  const addFriend = useFriendStore(s => s.addFriend);
  const addContact = useChatStore(s => s.addContact);
  const addConversation = useChatStore(s => s.addConversation);
  const setActive = useChatStore(s => s.setActiveConversation);
  const conversations = useChatStore((s) => s.conversations ?? {});
  const sessionToken = useAuthStore(s => s.sessionToken);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (userId && sessionToken) fetchIncoming(userId);
  }, [userId, sessionToken]);

  const handleAccept = async (reqId: string, fromUser: string, fromName: string) => {
    if (!userId) return;
    setBusyId(reqId);
    const result = await acceptReq(reqId, userId);
    if (result) {
      removeIncoming(reqId);
      addFriend({ userId: fromUser, displayName: fromName });

      // Add as contact
      const contact: UIContact = {
        id: fromUser,
        displayName: fromName,
        identityKey: '',
        trustLevel: 'unverified',
        addedAt: Date.now(),
      };
      addContact(contact);

      // Create DM conversation on THIS side
      const convId = [userId, fromUser].sort().join(':');
      if (!conversations[convId]) {
        addConversation({
          id: convId,
          type: 'dm',
          members: [userId, fromUser],
          createdAt: Date.now(),
          unreadCount: 0,
        });
      }
      setActive(convId);

      // Notify the other user via RLY so they also get the conversation
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

  if (incoming.length === 0) return null;

  return (
    <div className="friend-requests-panel">
      <div className="friend-requests-panel__header">
        <User size={14} />
        <span>Friend Requests</span>
        <Badge variant="danger">{incoming.length}</Badge>
      </div>
      <div className="friend-requests-panel__list">
        {incoming.map((req) => (
          <div key={req.id} className="friend-requests-panel__item">
            <Avatar name={req.displayName} size={36} />
            <div className="friend-requests-panel__info">
              <span className="friend-requests-panel__name">{req.displayName}</span>
              <span className="friend-requests-panel__sub">@{req.fromUser}</span>
            </div>
            <div className="friend-requests-panel__actions">
              <button
                className="friend-requests-panel__btn friend-requests-panel__btn--accept"
                onClick={() => handleAccept(req.id, req.fromUser, req.displayName)}
                disabled={busyId === req.id}
                title="Accept"
              >
                <Check size={16} />
              </button>
              <button
                className="friend-requests-panel__btn friend-requests-panel__btn--reject"
                onClick={() => handleReject(req.id)}
                disabled={busyId === req.id}
                title="Decline"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
