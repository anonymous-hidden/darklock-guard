/**
 * commandStore — Zustand store for slash command UI state, history, and ephemeral messages.
 */
import { create } from "zustand";
import type { SlashCommand, CommandResult, CommandLogEntry } from "../types";
import {
  getAllCommands,
  getAutocompleteSuggestions,
  parseCommandInput,
  executeCommand,
  type CommandContext,
} from "../lib/commandRegistry";

interface EphemeralMessage {
  id: string;
  content: string;
  timestamp: number;
  command: string;
  data?: Record<string, unknown>;
}

interface CommandState {
  /** Whether the slash command menu is open */
  menuOpen: boolean;
  /** Current text input (the "/" partial) */
  inputText: string;
  /** Filtered suggestions based on current input */
  suggestions: SlashCommand[];
  /** Index of the highlighted suggestion */
  highlightIndex: number;
  /** Currently selected command (for param input) */
  activeCommand: SlashCommand | null;
  /** Current param being filled */
  activeParamIndex: number;
  /** Ephemeral messages visible only to current user */
  ephemeralMessages: Record<string, EphemeralMessage[]>; // sessionId → messages
  /** Command execution history */
  history: CommandLogEntry[];
  /** Whether a command is currently executing */
  executing: boolean;

  // ── Actions ──
  openMenu: () => void;
  closeMenu: () => void;
  setInputText: (text: string) => void;
  moveHighlight: (direction: "up" | "down") => void;
  selectSuggestion: (index?: number) => void;
  clearActiveCommand: () => void;
  execute: (input: string, ctx: CommandContext) => Promise<CommandResult | null>;
  addEphemeral: (sessionId: string, msg: EphemeralMessage) => void;
  clearEphemeral: (sessionId: string) => void;
  clearHistory: () => void;
}

export const useCommandStore = create<CommandState>((set, get) => ({
  menuOpen: false,
  inputText: "",
  suggestions: [],
  highlightIndex: 0,
  activeCommand: null,
  activeParamIndex: 0,
  ephemeralMessages: {},
  history: [],
  executing: false,

  openMenu: () => {
    const all = getAllCommands();
    set({ menuOpen: true, suggestions: all, highlightIndex: 0 });
  },

  closeMenu: () =>
    set({ menuOpen: false, suggestions: [], highlightIndex: 0, activeCommand: null, activeParamIndex: 0, inputText: "" }),

  setInputText: (text) => {
    if (!text.startsWith("/")) {
      set({ menuOpen: false, suggestions: [], inputText: text });
      return;
    }

    const query = text.slice(1); // strip leading /
    const suggestions = getAutocompleteSuggestions(query, {
      userId: "",
      username: "",
      userPermissions: 0,
      userRoles: [],
      isOwner: false,
      isAdmin: false,
    });
    set({
      menuOpen: suggestions.length > 0,
      suggestions,
      highlightIndex: 0,
      inputText: text,
    });
  },

  moveHighlight: (direction) => {
    const { suggestions, highlightIndex } = get();
    if (!suggestions.length) return;
    const next =
      direction === "down"
        ? (highlightIndex + 1) % suggestions.length
        : (highlightIndex - 1 + suggestions.length) % suggestions.length;
    set({ highlightIndex: next });
  },

  selectSuggestion: (index) => {
    const { suggestions, highlightIndex } = get();
    const i = index ?? highlightIndex;
    const cmd = suggestions[i];
    if (!cmd) return;

    if (cmd.params.length > 0) {
      set({ activeCommand: cmd, activeParamIndex: 0, menuOpen: false, inputText: `/${cmd.name} ` });
    } else {
      set({ activeCommand: cmd, activeParamIndex: 0, menuOpen: false, inputText: `/${cmd.name}` });
    }
  },

  clearActiveCommand: () => set({ activeCommand: null, activeParamIndex: 0 }),

  execute: async (input, ctx) => {
    set({ executing: true });
    try {
      const parsed = parseCommandInput(input);
      if (!parsed) {
        set({ executing: false });
        return null;
      }

      const result = await executeCommand(parsed.name, parsed.args, ctx);

      // Record in history
      const entry: CommandLogEntry = {
        id: crypto.randomUUID(),
        user_id: ctx.userId,
        server_id: ctx.serverId ?? "",
        username: ctx.username,
        command: parsed.name,
        params: parsed.args,
        result: result.success ? "success" : "error",
        error_message: result.success ? undefined : result.message,
        created_at: new Date().toISOString(),
      };
      set((s) => ({ history: [entry, ...s.history].slice(0, 100) }));

      // If ephemeral, add to ephemeral messages
      if (result.ephemeral && ctx.channelId) {
        const msg: EphemeralMessage = {
          id: crypto.randomUUID(),
          content: result.message,
          timestamp: Date.now(),
          command: parsed.name,
          data: result.data as Record<string, unknown>,
        };
        const sessionId = ctx.channelId;
        set((s) => ({
          ephemeralMessages: {
            ...s.ephemeralMessages,
            [sessionId]: [...(s.ephemeralMessages[sessionId] ?? []), msg],
          },
        }));
      }

      set({ executing: false, activeCommand: null, activeParamIndex: 0, inputText: "" });
      return result;
    } catch (err) {
      set({ executing: false });
      return { success: false, message: String(err), ephemeral: true };
    }
  },

  addEphemeral: (sessionId, msg) =>
    set((s) => ({
      ephemeralMessages: {
        ...s.ephemeralMessages,
        [sessionId]: [...(s.ephemeralMessages[sessionId] ?? []), msg],
      },
    })),

  clearEphemeral: (sessionId) =>
    set((s) => ({
      ephemeralMessages: { ...s.ephemeralMessages, [sessionId]: [] },
    })),

  clearHistory: () => set({ history: [] }),
}));
