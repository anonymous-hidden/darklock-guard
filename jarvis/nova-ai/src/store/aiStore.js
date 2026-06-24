/**
 * aiStore — chat conversation state, streaming status, transparency log.
 *
 * The conversation is held in a `ConversationManager` instance so message
 * history and context-window trimming live in one place. The store mirrors
 * the messages array for React rendering.
 */
import { create } from 'zustand';
import { ConversationManager } from '@core/ai/ConversationManager.js';
import { CHAT_MODE } from '@core/ai/PromptEngine.js';

const conversation = new ConversationManager({ systemPrompt: CHAT_MODE });

let logId = 0;
function nextLogId() { logId += 1; return `log_${Date.now().toString(36)}_${logId}`; }

export const useAiStore = create((set, get) => ({
  conversation,
  messages: [],
  streaming: false,
  abortController: null,
  /** transparency log entries: { id, ts, level, source, text } */
  log: [],

  reset() {
    const c = get().conversation;
    c.reset();
    set({ messages: [], streaming: false, log: [] });
  },

  setSystemPrompt(p) {
    get().conversation.setSystemPrompt(p);
  },

  pushUser(content) {
    const m = get().conversation.addUser(content);
    set({ messages: [...get().conversation.messages] });
    return m;
  },

  pushAssistantStreaming(initialText = '') {
    const m = get().conversation.addAssistant(initialText, { _streaming: true });
    set({ messages: [...get().conversation.messages] });
    return m;
  },

  pushAssistant(content, extra = {}) {
    const m = get().conversation.addAssistant(content, extra);
    set({ messages: [...get().conversation.messages] });
    return m;
  },

  updateLastAssistant(content) {
    get().conversation.updateLastAssistant(content);
    set({ messages: [...get().conversation.messages] });
  },

  finishLastAssistant(extra = {}) {
    const c = get().conversation;
    const last = c.messages[c.messages.length - 1];
    if (last && last.role === 'assistant') {
      Object.assign(last, { _streaming: false, ...extra });
    }
    set({ messages: [...c.messages] });
  },

  removeMessage(id) {
    const c = get().conversation;
    c.removeById(id);
    set({ messages: [...c.messages] });
  },

  setStreaming(b)        { set({ streaming: !!b }); },
  setAbortController(ac) { set({ abortController: ac || null }); },

  abort() {
    const ac = get().abortController;
    if (ac) { try { ac.abort(); } catch {} }
    set({ abortController: null, streaming: false });
  },

  log_(level, source, text) {
    const entry = { id: nextLogId(), ts: Date.now(), level, source, text: String(text || '') };
    set({ log: [...get().log, entry].slice(-500) });
  },
  logInfo(source, text)  { get().log_('info', source, text); },
  logWarn(source, text)  { get().log_('warn', source, text); },
  logError(source, text) { get().log_('error', source, text); },
  logToken(source, text) { get().log_('token', source, text); },
  clearLog() { set({ log: [] }); },
}));
