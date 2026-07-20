import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => {
  const connectionState = {
    wsUrl: 'ws://relay.test/ws',
    setStatus: vi.fn(),
    setLatency: vi.fn(),
  };

  const authState = {
    sessionToken: 'session-token',
  };

  const chatState = {
    typingUsers: {},
    setContactOnline: vi.fn(),
    setRemoteProfile: vi.fn(),
    setTypingUsers: vi.fn(),
    deleteMessage: vi.fn(),
    editMessage: vi.fn(),
  };

  const profileState = {
    displayName: 'Alice',
    username: 'alice',
    avatar: '',
    banner: '',
    bio: '',
    pronouns: '',
    usernameColor: '#ffffff',
    accentColor: '#000000',
    accentColor2: '',
    gradientAngle: 135,
    nameplate: '',
    sectionOrder: ['tags', 'status', 'bio', 'links'],
    presence: 'online',
    statusText: '',
    statusEmoji: '',
    links: [],
  };

  const tagState = {
    userTags: {},
    giveTag: vi.fn(),
    removeTag: vi.fn(),
  };

  return { connectionState, authState, chatState, profileState, tagState };
});

vi.mock('../stores/connectionStore.js', () => ({
  useConnectionStore: {
    getState: () => mocked.connectionState,
  },
}));

vi.mock('../stores/authStore.js', () => ({
  useAuthStore: {
    getState: () => mocked.authState,
  },
}));

vi.mock('../stores/chatStore.js', () => ({
  useChatStore: {
    getState: () => mocked.chatState,
  },
}));

vi.mock('../stores/profileStore.js', () => ({
  useProfileStore: {
    getState: () => mocked.profileState,
  },
}));

vi.mock('../stores/tagStore.js', () => ({
  useTagStore: {
    getState: () => mocked.tagState,
  },
}));

vi.mock('./idsClient.js', () => ({
  fetchRelaySendPermit: vi.fn(),
}));

import { fetchRelaySendPermit } from './idsClient.js';
import {
  connect,
  disconnect,
  sendCallEvent,
  sendCallEventFanout,
  sendDeleteMessage,
  sendEditMessage,
  sendFriendAccept,
  sendFriendRequest,
  sendGroupInvite,
  sendGroupMessage,
  sendGroupSettingsUpdate,
  sendMessage,
  sendOpenDm,
  sendReceipt,
  sendTagUpdate,
  sendTyping,
} from './wsClient';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(payload: string) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  triggerOpen() {
    this.readyState = 1;
    this.onopen?.();
  }
}

function setupConnectedSocket() {
  connect('alice');
  const socket = MockWebSocket.instances.at(-1);
  if (!socket) throw new Error('expected mock socket instance');
  socket.triggerOpen();
  socket.sent = [];
  return socket;
}

describe('wsClient relay permit attachment', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    mocked.authState.sessionToken = 'session-token';
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    disconnect();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('typing sends with a permit', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-typing', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendTyping('bob', 'conv-1');

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', { type: 'typing', to: 'bob' });
    expect(socket.sent).toEqual([
      {
        type: 'typing',
        to: 'bob',
        conversationId: 'conv-1',
        permit: 'permit-typing',
      },
    ]);
  });

  it('receipt sends with a permit', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-receipt', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendReceipt('bob', 'msg-1', 'delivered');

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', { type: 'receipt', to: 'bob' });
    expect(socket.sent).toEqual([
      {
        type: 'receipt',
        to: 'bob',
        messageId: 'msg-1',
        status: 'delivered',
        permit: 'permit-receipt',
      },
    ]);
  });

  it('edit_message sends with a permit', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-edit', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendEditMessage('bob', 'msg-2', 'conv-2', 'updated');

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', { type: 'edit_message', to: 'bob' });
    expect(socket.sent).toEqual([
      {
        type: 'edit_message',
        to: 'bob',
        messageId: 'msg-2',
        conversationId: 'conv-2',
        newText: 'updated',
        permit: 'permit-edit',
      },
    ]);
  });

  it('delete_message sends with a permit', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-delete', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendDeleteMessage('bob', 'msg-3', 'conv-3');

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', { type: 'delete_message', to: 'bob' });
    expect(socket.sent).toEqual([
      {
        type: 'delete_message',
        to: 'bob',
        messageId: 'msg-3',
        conversationId: 'conv-3',
        permit: 'permit-delete',
      },
    ]);
  });

  it('friend_accept sends with a permit', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-friend-accept', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendFriendAccept('bob', 'Alice');

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', { type: 'friend_accept', to: 'bob' });
    expect(socket.sent).toEqual([
      {
        type: 'friend_accept',
        to: 'bob',
        displayName: 'Alice',
        permit: 'permit-friend-accept',
      },
    ]);
  });

  it('open_dm sends with a permit', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-open-dm', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendOpenDm('bob', 'Alice');

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', { type: 'open_dm', to: 'bob' });
    expect(socket.sent).toEqual([
      {
        type: 'open_dm',
        to: 'bob',
        displayName: 'Alice',
        permit: 'permit-open-dm',
      },
    ]);
  });

  it('friend_request sends with a permit', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-friend-request', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendFriendRequest('bob', 42, 'Alice');

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', { type: 'friend_request', to: 'bob' });
    expect(socket.sent).toEqual([
      {
        type: 'friend_request',
        to: 'bob',
        requestId: 42,
        displayName: 'Alice',
        permit: 'permit-friend-request',
      },
    ]);
  });

  it('message sends with a permit', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-message', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendMessage('bob', '{"ciphertext":"abc"}', 'msg-11');

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', { type: 'message', to: 'bob' });
    expect(socket.sent).toEqual([
      {
        type: 'message',
        to: 'bob',
        payload: '{"ciphertext":"abc"}',
        id: 'msg-11',
        permit: 'permit-message',
      },
    ]);
  });

  it('group_message sends with a permit bound to recipients and groupId', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-group-message', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendGroupMessage('group-7', ['bob', 'carol'], '{"ciphertext":"xyz"}', 'msg-12');

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', {
      type: 'group_message',
      groupId: 'group-7',
      recipients: ['bob', 'carol'],
    });
    expect(socket.sent).toEqual([
      {
        type: 'group_message',
        groupId: 'group-7',
        recipients: ['bob', 'carol'],
        payload: '{"ciphertext":"xyz"}',
        id: 'msg-12',
        permit: 'permit-group-message',
      },
    ]);
  });

  it('group_message includes channel metadata when provided', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-group-message-channel', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendGroupMessage(
      'group-7',
      ['bob'],
      '{"ciphertext":"xyz"}',
      'msg-13',
      ' channel-9 ',
      `  ${'very-long-channel-name-'.repeat(4)}  `,
    );

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', {
      type: 'group_message',
      groupId: 'group-7',
      recipients: ['bob'],
    });

    const expectedChannelName = ('very-long-channel-name-'.repeat(4)).slice(0, 64);
    expect(socket.sent).toEqual([
      {
        type: 'group_message',
        groupId: 'group-7',
        recipients: ['bob'],
        payload: '{"ciphertext":"xyz"}',
        id: 'msg-13',
        channelId: 'channel-9',
        channelName: expectedChannelName,
        permit: 'permit-group-message-channel',
      },
    ]);
  });

  it('group_settings_update sends with a permit bound to recipients and groupId', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-group-settings-update', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendGroupSettingsUpdate('group-7', ['bob'], {
      theme: {
        bgType: 'solid',
        bgValue: '#111318',
      },
    });

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', {
      type: 'group_settings_update',
      groupId: 'group-7',
      recipients: ['bob'],
    });
    expect(socket.sent).toEqual([
      {
        type: 'group_settings_update',
        groupId: 'group-7',
        recipients: ['bob'],
        settings: {
          theme: {
            bgType: 'solid',
            bgValue: '#111318',
          },
        },
        permit: 'permit-group-settings-update',
      },
    ]);
  });

  it('call_invite sends with a permit', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-call-invite', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendCallEvent('call_invite', 'bob', '{"e2ee":true}', 123);

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', { type: 'call_invite', to: 'bob' });
    expect(socket.sent).toEqual([
      {
        type: 'call_invite',
        to: 'bob',
        payload: '{"e2ee":true}',
        timestamp: 123,
        permit: 'permit-call-invite',
      },
    ]);
  });

  it('call_accept sends with a permit', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-call-accept', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendCallEvent('call_accept', 'bob', '{"e2ee":true}', 456);

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', { type: 'call_accept', to: 'bob' });
    expect(socket.sent).toEqual([
      {
        type: 'call_accept',
        to: 'bob',
        payload: '{"e2ee":true}',
        timestamp: 456,
        permit: 'permit-call-accept',
      },
    ]);
  });

  it('call_reject sends with a permit', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-call-reject', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendCallEvent('call_reject', 'bob', '{"e2ee":true}', 654);

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', { type: 'call_reject', to: 'bob' });
    expect(socket.sent).toEqual([
      {
        type: 'call_reject',
        to: 'bob',
        payload: '{"e2ee":true}',
        timestamp: 654,
        permit: 'permit-call-reject',
      },
    ]);
  });

  it('call_end sends with a permit', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-call-end', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendCallEvent('call_end', 'bob', '{"e2ee":true}', 789);

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', { type: 'call_end', to: 'bob' });
    expect(socket.sent).toEqual([
      {
        type: 'call_end',
        to: 'bob',
        payload: '{"e2ee":true}',
        timestamp: 789,
        permit: 'permit-call-end',
      },
    ]);
  });

  it('call_signal sends with a permit', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-call-signal', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendCallEvent('call_signal', 'bob', '{"signalType":"offer"}', 101112);

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', { type: 'call_signal', to: 'bob' });
    expect(socket.sent).toEqual([
      {
        type: 'call_signal',
        to: 'bob',
        payload: '{"signalType":"offer"}',
        timestamp: 101112,
        permit: 'permit-call-signal',
      },
    ]);
  });

  it('call_media sends with a permit', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-call-media', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendCallEvent('call_media', 'bob', '{"audioMuted":false}', 131415);

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', { type: 'call_media', to: 'bob' });
    expect(socket.sent).toEqual([
      {
        type: 'call_media',
        to: 'bob',
        payload: '{"audioMuted":false}',
        timestamp: 131415,
        permit: 'permit-call-media',
      },
    ]);
  });

  it('group_invite sends with a permit bound to recipients and groupId', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-group-invite', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendGroupInvite(
      'group-1',
      'My Group',
      [
        { userId: 'alice', role: 'admin', joinedAt: 1 },
        { userId: 'bob', role: 'member', joinedAt: 1 },
      ],
      ['bob', 'carol'],
    );

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', {
      type: 'group_invite',
      groupId: 'group-1',
      recipients: ['bob', 'carol'],
    });
    expect(socket.sent).toEqual([
      {
        type: 'group_invite',
        groupId: 'group-1',
        groupName: 'My Group',
        members: [
          { userId: 'alice', role: 'admin', joinedAt: 1 },
          { userId: 'bob', role: 'member', joinedAt: 1 },
        ],
        recipients: ['bob', 'carol'],
        permit: 'permit-group-invite',
      },
    ]);
  });

  it('tag_update sends with a permit', async () => {
    vi.mocked(fetchRelaySendPermit).mockResolvedValue({ permit: 'permit-tag-update', expires_in_seconds: 60 });
    const socket = setupConnectedSocket();

    const sent = await sendTagUpdate('bob', 'mod', 'give');

    expect(sent).toBe(true);
    expect(fetchRelaySendPermit).toHaveBeenCalledWith('session-token', { type: 'tag_update', to: 'bob' });
    expect(socket.sent).toEqual([
      expect.objectContaining({
        type: 'tag_update',
        to: 'bob',
        targetUserId: 'bob',
        tagId: 'mod',
        action: 'give',
        permit: 'permit-tag-update',
      }),
    ]);
    expect(typeof socket.sent[0].timestamp).toBe('number');
  });

  it('call fanout acquires all permits before sending any packet', async () => {
    vi.mocked(fetchRelaySendPermit)
      .mockResolvedValueOnce({ permit: 'permit-call-end-bob', expires_in_seconds: 60 })
      .mockRejectedValueOnce(new Error('ids unavailable'));
    const socket = setupConnectedSocket();

    const sent = await sendCallEventFanout('call_end', [
      { to: 'bob', payload: '{"e2ee":true}', timestamp: 1 },
      { to: 'carol', payload: '{"e2ee":true}', timestamp: 2 },
    ]);

    expect(sent).toBe(false);
    expect(socket.sent).toEqual([]);
  });

  it('failed permit fetch prevents sending', async () => {
    vi.mocked(fetchRelaySendPermit).mockRejectedValue(new Error('ids unavailable'));
    const socket = setupConnectedSocket();

    const sent = await sendTyping('bob', 'conv-7');

    expect(sent).toBe(false);
    expect(socket.sent).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith('[RELAY_PERMIT_FETCH_FAILED]');
  });

  it('never logs permit token values', async () => {
    vi.mocked(fetchRelaySendPermit).mockRejectedValue(new Error('permit leak token=permit-secret-123'));
    const socket = setupConnectedSocket();

    const sent = await sendReceipt('bob', 'msg-9', 'read');

    expect(sent).toBe(false);
    expect(socket.sent).toEqual([]);
    const logged = warnSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('permit-secret-123');
  });
});
