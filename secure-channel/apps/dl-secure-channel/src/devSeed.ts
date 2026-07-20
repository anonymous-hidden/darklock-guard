/* ──────────────────────────────────────────────────────────
 *  DEV SEED — temporary test data
 *
 *  ⚠️  REMOVE BEFORE PUBLIC RELEASE ⚠️
 *  Delete this file and remove the import from main.tsx
 *  (search for "DEV_SEED" to find all references)
 * ────────────────────────────────────────────────────────── */

import { useChatStore } from './stores/chatStore';
import { useTagStore } from './stores/tagStore';
import { useFriendStore } from './stores/friendStore';

const TEST_USER_ID = 'test-user-temp-9999';
const DEV_PEERS: Record<string, { id: string; displayName: string } | undefined> = {
  'ridgeline-user-one': { id: 'ridgeline-user-two', displayName: 'Ridgeline User Two' },
  'ridgeline-user-two': { id: 'ridgeline-user-one', displayName: 'Ridgeline User One' },
  'dev-user-0000': { id: 'ridgeline-user-one', displayName: 'Ridgeline User One' },
};

export function seedDevData(currentUserId = 'dev-user-0000') {
  const chat = useChatStore.getState();
  const tags = useTagStore.getState();
  const friends = useFriendStore.getState();
  const now = Date.now();

  // ── Test contact ───────────────────────────────────────
  if (!chat.contacts[TEST_USER_ID]) {
    chat.addContact({
      id: TEST_USER_ID,
      displayName: 'Test User (TEMP)',
      identityKey: btoa('dev-test-key-placeholder'),
      trustLevel: 'trusted',
      addedAt: now,
      online: true,
      lastSeen: now,
    });
  }

  // ── Dev peer contact/friend (for multi-session local testing) ─────────
  const peer = DEV_PEERS[currentUserId];
  if (peer && !chat.contacts[peer.id]) {
    chat.addContact({
      id: peer.id,
      displayName: peer.displayName,
      identityKey: btoa(`dev-peer-key-${peer.id}`),
      trustLevel: 'trusted',
      addedAt: now,
      online: true,
      lastSeen: now,
    });
  }
  if (peer) {
    friends.addFriend({ userId: peer.id, displayName: peer.displayName });
  }

  // ── Conversation with test user ────────────────────────
  const convId = 'test-conv-' + TEST_USER_ID;
  if (!chat.conversations[convId]) {
    chat.addConversation({
      id: convId,
      type: 'dm',
      members: [currentUserId, TEST_USER_ID],
      createdAt: now,
      unreadCount: 2,
      muted: false,
    });
  }

  if (peer) {
    const peerConvId = [currentUserId, peer.id].sort().join(':');
    if (!chat.conversations[peerConvId]) {
      chat.addConversation({
        id: peerConvId,
        type: 'dm',
        members: [currentUserId, peer.id],
        createdAt: now,
        unreadCount: 0,
        muted: false,
      });
    }
  }

  // ── Seed some messages ─────────────────────────────────
  if (!chat.messages[convId] || chat.messages[convId].length === 0) {
    chat.setMessages(convId, [
      {
        id: 'seed-msg-1',
        conversationId: convId,
        senderId: TEST_USER_ID,
        content: 'Hey, this is the temp test account.',
        timestamp: now - 60_000 * 5,
        status: 'read',
      },
      {
        id: 'seed-msg-2',
        conversationId: convId,
        senderId: TEST_USER_ID,
        content: 'You can give me tags in the Admin panel and test the tag system from there.',
        timestamp: now - 60_000 * 2,
        status: 'read',
      },
      {
        id: 'seed-msg-3',
        conversationId: convId,
        senderId: currentUserId,
        content: 'Got it - will remove this account before going public.',
        timestamp: now - 60_000,
        status: 'delivered',
      },
    ]);
  }

  if (peer) {
    const peerConvId = [currentUserId, peer.id].sort().join(':');
    if (!chat.messages[peerConvId] || chat.messages[peerConvId].length === 0) {
      chat.setMessages(peerConvId, [
        {
          id: `seed-peer-${currentUserId}-1`,
          conversationId: peerConvId,
          senderId: peer.id,
          content: `Hey ${currentUserId}, ready to test DMs?`,
          timestamp: now - 60_000 * 3,
          status: 'read',
        },
        {
          id: `seed-peer-${currentUserId}-2`,
          conversationId: peerConvId,
          senderId: currentUserId,
          content: 'Yep - lets test user-to-user messaging now.',
          timestamp: now - 60_000,
          status: 'delivered',
        },
      ]);
    }
  }

  // ── Give the test user a couple of demo tags ───────────
  tags.giveTag(TEST_USER_ID, 'beta-tester');
  tags.giveTag(TEST_USER_ID, 'early-adopter');

  console.log('[DEV_SEED_USER_CREATED]');
}

/** Remove this user from all stores (useful for testing the remove flow) */
export function removeTestUser() {
  useChatStore.getState().removeContact(TEST_USER_ID);
  useTagStore.getState().removeUser(TEST_USER_ID);
  console.log('[DEV SEED] Test user removed');
}

export { TEST_USER_ID };
