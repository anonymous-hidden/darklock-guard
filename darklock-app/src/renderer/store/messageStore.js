import { create } from 'zustand';

// In-memory only — messages are NEVER persisted to disk
export const useMessageStore = create((set, get) => ({
  messages: {},    // channelId → message[]
  typingUsers: {}, // channelId → Set<userId>

  addMessage: (channelId, message) => set(state => {
    const existing = state.messages[channelId] || [];
    return {
      messages: {
        ...state.messages,
        [channelId]: [...existing, message]
      }
    };
  }),

  destroyMessage: (messageId) => set(state => {
    const updated = {};
    for (const [channelId, msgs] of Object.entries(state.messages)) {
      updated[channelId] = msgs.map(m =>
        m.id === messageId ? { ...m, content: null, destroyed: true } : m
      );
    }
    return { messages: updated };
  }),

  clearChannel: (channelId) => set(state => ({
    messages: { ...state.messages, [channelId]: [] }
  })),

  clearAll: () => set({ messages: {}, typingUsers: {} }),

  setTyping: (channelId, userId, isTyping) => set(state => {
    const current = new Set(state.typingUsers[channelId] || []);
    if (isTyping) current.add(userId);
    else current.delete(userId);
    return {
      typingUsers: { ...state.typingUsers, [channelId]: current }
    };
  }),

  getChannelMessages: (channelId) => {
    return get().messages[channelId] || [];
  },

  getTypingUsers: (channelId) => {
    return Array.from(get().typingUsers[channelId] || []);
  }
}));
