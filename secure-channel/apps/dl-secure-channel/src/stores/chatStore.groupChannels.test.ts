import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGroupChannelConversationId } from '../utils/groupChannelKeys';

const mocked = vi.hoisted(() => ({
  authState: {
    userId: 'alice',
  },
  showNotification: vi.fn(),
}));

vi.mock('./authStore', () => ({
  useAuthStore: {
    getState: () => mocked.authState,
  },
}));

vi.mock('./convSecurityStore', () => ({
  useConvSecurityStore: {
    getState: () => ({
      get: () => ({ disappearTimer: 'off' }),
    }),
  },
}));

vi.mock('../hooks/useSettingsEffects', () => ({
  showNotification: mocked.showNotification,
}));

type LocalStorageMock = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
  key: (index: number) => string | null;
  readonly length: number;
};

function createLocalStorageMock(): LocalStorageMock {
  const backing = new Map<string, string>();
  return {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => {
      backing.set(key, value);
    },
    removeItem: (key) => {
      backing.delete(key);
    },
    clear: () => {
      backing.clear();
    },
    key: (index) => Array.from(backing.keys())[index] ?? null,
    get length() {
      return backing.size;
    },
  };
}

describe('chatStore group channel unread behavior', () => {
  let useChatStore: typeof import('./chatStore').useChatStore;

  beforeEach(async () => {
    mocked.showNotification.mockReset();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createLocalStorageMock(),
    });

    vi.resetModules();
    ({ useChatStore } = await import('./chatStore'));
  });

  it('isolates group channel timelines and only increments unread for inactive channels', () => {
    const groupId = 'group-1';
    const generalChannelId = 'chan-general';
    const opsChannelId = 'chan-ops';
    const now = 1_000;

    useChatStore.getState().addConversation({
      id: groupId,
      type: 'group',
      name: 'Ops Room',
      members: ['alice', 'bob'],
      createdAt: now,
      unreadCount: 0,
    });

    useChatStore.getState().setGroupInfo(groupId, {
      id: groupId,
      name: 'Ops Room',
      members: [
        { userId: 'alice', role: 'admin', roleIds: ['everyone'], joinedAt: now },
        { userId: 'bob', role: 'member', roleIds: ['everyone'], joinedAt: now },
      ],
      channels: [
        { id: generalChannelId, name: 'general', type: 'text', categoryId: 'cat-text', position: 0 },
        { id: opsChannelId, name: 'ops', type: 'text', categoryId: 'cat-text', position: 1 },
      ],
      categories: [{ id: 'cat-text', name: 'Text Channels', position: 0 }],
      roles: [],
      auditLog: [],
      createdAt: now,
      createdBy: 'alice',
    } as any);

    useChatStore.getState().setSidebarMode('group', groupId);
    expect(useChatStore.getState().activeChannelId).toBe(generalChannelId);

    const generalConversationId = makeGroupChannelConversationId(groupId, generalChannelId);
    const opsConversationId = makeGroupChannelConversationId(groupId, opsChannelId);

    useChatStore.getState().addMessage(generalConversationId, {
      id: 'general-1',
      conversationId: generalConversationId,
      senderId: 'bob',
      content: 'General hello',
      timestamp: now + 1,
      status: 'delivered',
    });

    let state = useChatStore.getState();
    expect(state.conversations[groupId]?.unreadCount).toBe(0);
    expect(state.conversations[groupId]?.unread).toBe(0);
    expect((state.messages[generalConversationId] ?? []).map((m) => m.id)).toEqual(['general-1']);
    expect(state.messages[opsConversationId]).toBeUndefined();

    useChatStore.getState().addMessage(opsConversationId, {
      id: 'ops-1',
      conversationId: opsConversationId,
      senderId: 'bob',
      content: 'Ops update',
      timestamp: now + 2,
      status: 'delivered',
    });

    state = useChatStore.getState();
    expect(state.conversations[groupId]?.unreadCount).toBe(1);
    expect(state.conversations[groupId]?.unread).toBe(1);
    expect((state.messages[generalConversationId] ?? []).map((m) => m.id)).toEqual(['general-1']);
    expect((state.messages[opsConversationId] ?? []).map((m) => m.id)).toEqual(['ops-1']);

    useChatStore.getState().setActiveChannel(opsChannelId);
    useChatStore.getState().addMessage(opsConversationId, {
      id: 'ops-2',
      conversationId: opsConversationId,
      senderId: 'bob',
      content: 'Ops follow-up',
      timestamp: now + 3,
      status: 'delivered',
    });

    state = useChatStore.getState();
    expect(state.conversations[groupId]?.unreadCount).toBe(1);
    expect(state.conversations[groupId]?.unread).toBe(1);
    expect((state.messages[generalConversationId] ?? []).map((m) => m.id)).toEqual(['general-1']);
    expect((state.messages[opsConversationId] ?? []).map((m) => m.id)).toEqual(['ops-1', 'ops-2']);

    useChatStore.getState().markRead(groupId);

    state = useChatStore.getState();
    expect(state.conversations[groupId]?.unreadCount).toBe(0);
    expect(state.conversations[groupId]?.unread).toBe(0);
  });
});
