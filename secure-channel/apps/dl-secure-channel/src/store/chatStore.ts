import { create } from "zustand";
import type { ContactDto, GroupDto, MessageDto } from "../types";
import { appendMessageToSession, mergeMessagesBySession } from "./messageMerge";

interface ChatState {
  contacts: ContactDto[];
  groups: GroupDto[];
  activeSessionId: string | null;
  activeContactId: string | null;
  messages: Record<string, MessageDto[]>; // sessionId → messages

  setContacts: (contacts: ContactDto[]) => void;
  setGroups: (groups: GroupDto[]) => void;
  setActiveSession: (sessionId: string, contactId: string) => void;
  clearActiveSession: () => void;
  setMessages: (sessionId: string, msgs: MessageDto[]) => void;
  appendMessage: (sessionId: string, msg: MessageDto) => void;
  appendMessages: (msgs: MessageDto[]) => void;
  upsertMessage: (sessionId: string, msg: MessageDto) => void;
  replaceMessage: (sessionId: string, oldId: string, msg: MessageDto) => void;
  setMessageDeliveryState: (sessionId: string, messageId: string, state: MessageDto["delivery_state"]) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  contacts: [],
  groups: [],
  activeSessionId: null,
  activeContactId: null,
  messages: {},

  setContacts: (contacts) => set({ contacts }),
  setGroups: (groups) => set({ groups }),

  setActiveSession: (sessionId, contactId) =>
    set({ activeSessionId: sessionId, activeContactId: contactId }),

  clearActiveSession: () =>
    set({ activeSessionId: null, activeContactId: null }),

  setMessages: (sessionId, msgs) =>
    set((state) => ({
      messages: { ...state.messages, [sessionId]: msgs },
    })),

  appendMessage: (sessionId, msg) =>
    set((state) => {
      const existing = state.messages[sessionId] ?? [];
      return { messages: { ...state.messages, [sessionId]: appendMessageToSession(existing, msg) } };
    }),

  appendMessages: (msgs) =>
    set((state) => {
      return { messages: mergeMessagesBySession(state.messages, msgs) };
    }),

  upsertMessage: (sessionId, msg) =>
    set((state) => {
      const existing = state.messages[sessionId] ?? [];
      return { messages: { ...state.messages, [sessionId]: appendMessageToSession(existing, msg) } };
    }),

  replaceMessage: (sessionId, oldId, msg) =>
    set((state) => {
      const existing = state.messages[sessionId] ?? [];
      const idx = existing.findIndex((m) => m.id === oldId);
      if (idx === -1) {
        // If we can't find it, just upsert the new message.
        const idx2 = existing.findIndex((m) => m.id === msg.id);
        if (idx2 !== -1) {
          const next = existing.slice();
          next[idx2] = { ...existing[idx2], ...msg };
          return { messages: { ...state.messages, [sessionId]: next } };
        }
        return { messages: { ...state.messages, [sessionId]: [...existing, msg] } };
      }
      const next = existing.slice();
      next[idx] = msg;
      return { messages: { ...state.messages, [sessionId]: next } };
    }),

  setMessageDeliveryState: (sessionId, messageId, delivery_state) =>
    set((state) => {
      const existing = state.messages[sessionId] ?? [];
      const idx = existing.findIndex((m) => m.id === messageId);
      if (idx === -1) return state;
      const next = existing.slice();
      next[idx] = { ...existing[idx], delivery_state };
      return { messages: { ...state.messages, [sessionId]: next } };
    }),
}));
