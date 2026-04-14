// ============================================================
// Home AI Assistant — Main Chat Application
// ChatGPT/Claude-like interface with voice support
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChatResult,
  clearHistory,
  deleteMemory,
  getApiKey,
  getLearningMemories,
  getLearningStats,
  healthCheck,
  LearningStats,
  learnFact,
  MemoryItem,
  pauseLearning,
  resumeLearning,
  sendMessage,
  setApiKey,
  submitFeedback,
  wipeLearning,
} from "./api";
import { speak, stopSpeaking, useVoice } from "./useVoice";

// ── Types ──────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  commands?: ChatResult["commands"];
  execution_results?: ChatResult["execution_results"];
  source?: "text" | "voice";
  feedback?: -1 | 0 | 1;  // thumbs down / neutral / thumbs up
}

// ── Chat Session Type ─────────────────────────────────────

interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

// ── Persistence ────────────────────────────────────────────

const STORAGE_KEY = "home_ai_chats";

function loadChats(): Chat[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = JSON.parse(raw) as any[];
    return parsed.map((c) => ({
      ...c,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: (c.messages as any[]).map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      })),
      createdAt: new Date(c.createdAt),
      updatedAt: new Date(c.updatedAt),
    }));
  } catch {
    return [];
  }
}

function saveChats(chats: Chat[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  } catch { /* storage full */ }
}

function formatTime(date: Date): string {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString();
}

// ── App Component ──────────────────────────────────────────

export default function App() {
  const [chats, setChats] = useState<Chat[]>(loadChats);
  const [activeChatId, setActiveChatId] = useState<string | null>(
    () => { const c = loadChats(); return c.length > 0 ? c[0].id : null; }
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyInput, setKeyInput] = useState(getApiKey());
  const [showLearning, setShowLearning] = useState(false);
  const [learningStats, setLearningStats] = useState<LearningStats | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);

  // Derive messages from the active chat
  const messages = chats.find((c) => c.id === activeChatId)?.messages ?? [];

  // Keep a ref so callbacks always see the latest activeChatId without stale closure
  const activeChatIdRef = useRef(activeChatId);
  useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);

  // Persist chats to localStorage whenever they change
  useEffect(() => { saveChats(chats); }, [chats]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Voice hook ─────────────────────────────────────────

  const { isRecording, isSupported, toggleRecording } = useVoice({
    onTranscript: (text) => {
      setInput(text);
      // Auto-send voice input
      handleSend(text, "voice");
    },
    onError: (err) => {
      addSystemMessage(`Voice error: ${err}`);
    },
  });

  // ── Create new chat ───────────────────────────────────

  const createNewChat = useCallback(() => {
    const chat: Chat = {
      id: crypto.randomUUID(),
      title: "New Chat",
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setChats((prev) => [chat, ...prev]);
    setActiveChatId(chat.id);
    activeChatIdRef.current = chat.id; // sync so addMessage sees it immediately
    return chat;
  }, []);

  // ── Helpers ────────────────────────────────────────────

  const addMessage = useCallback(
    (role: Message["role"], content: string, extra?: Partial<Message>) => {
      const msg: Message = {
        id: crypto.randomUUID(),
        role,
        content,
        timestamp: new Date(),
        ...extra,
      };
      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id !== activeChatIdRef.current) return chat;
          return {
            ...chat,
            messages: [...chat.messages, msg],
            updatedAt: new Date(),
            title:
              chat.title === "New Chat" && role === "user"
                ? content.slice(0, 42)
                : chat.title,
          };
        })
      );
      return msg;
    },
    []
  );

  const addSystemMessage = useCallback(
    (content: string) => addMessage("system", content),
    [addMessage]
  );

  // ── Scroll to bottom ──────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Health check ───────────────────────────────────────

  useEffect(() => {
    const check = async () => {
      try {
        const h = await healthCheck();
        setIsOnline(h.status === "ok");
      } catch {
        setIsOnline(false);
      }
    };
    check();
    const interval = setInterval(check, 15000);
    return () => clearInterval(interval);
  }, []);

  // ── Auto-resize textarea ──────────────────────────────

  // ── Feedback handler ──────────────────────────────────

  const handleFeedback = useCallback(
    async (msgId: string, rating: -1 | 1) => {
      // Find the AI message and the preceding user message
      const idx = messages.findIndex((m) => m.id === msgId);
      if (idx < 0) return;
      const aiMsg = messages[idx];
      const userMsg = messages
        .slice(0, idx)
        .reverse()
        .find((m) => m.role === "user");

      // Update local state
      setChats((prev) =>
        prev.map((chat) => ({
          ...chat,
          messages: chat.messages.map((m) =>
            m.id === msgId ? { ...m, feedback: rating } : m
          ),
        }))
      );

      try {
        await submitFeedback(
          msgId,
          rating,
          userMsg?.content || "",
          aiMsg.content,
        );
      } catch (err) {
        console.error("Feedback submission failed:", err);
      }
    },
    [messages]
  );

  // ── Learning panel loader ─────────────────────────────

  const loadLearningData = useCallback(async () => {
    try {
      const [stats, mems] = await Promise.all([
        getLearningStats(),
        getLearningMemories(),
      ]);
      setLearningStats(stats);
      setMemories(mems);
    } catch (err) {
      console.error("Failed to load learning data:", err);
    }
  }, []);

  useEffect(() => {
    if (showLearning) loadLearningData();
  }, [showLearning, loadLearningData]);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  }, [input]);

  // ── Send message ───────────────────────────────────────

  const handleSend = useCallback(
    async (text?: string, source: "text" | "voice" = "text") => {
      const msg = (text || input).trim();
      if (!msg || isLoading) return;

      // Ensure there is an active chat to receive messages
      if (!activeChatIdRef.current) createNewChat();

      setInput("");
      addMessage("user", msg, { source });
      setIsLoading(true);

      try {
        const result = await sendMessage(msg);

        addMessage("assistant", result.reply, {
          commands: result.commands,
          execution_results: result.execution_results,
        });

        // Speak the reply if voice mode is on
        if (voiceEnabled && source === "voice") {
          // Strip JSON code blocks from speech
          const speechText = result.reply
            .replace(/```[\s\S]*?```/g, "")
            .replace(/\{[\s\S]*?\}/g, "")
            .trim();
          if (speechText) speak(speechText, 1.0);
        }
      } catch (err: any) {
        addSystemMessage(`Error: ${err.message}`);
      } finally {
        setIsLoading(false);
        textareaRef.current?.focus();
      }
    },
    [input, isLoading, addMessage, addSystemMessage, voiceEnabled, createNewChat]
  );

  // ── Key handling ───────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="app-shell">
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        isOpen={sidebarOpen}
        onSelect={(id) => {
          clearHistory();
          setActiveChatId(id);
          activeChatIdRef.current = id;
          setShowLearning(false);
        }}
        onNew={() => {
          clearHistory();
          createNewChat();
          stopSpeaking();
          setShowLearning(false);
        }}
        onDelete={(id) => {
          setChats((prev) => {
            const next = prev.filter((c) => c.id !== id);
            if (id === activeChatIdRef.current) {
              const nextId = next[0]?.id ?? null;
              setActiveChatId(nextId);
              activeChatIdRef.current = nextId;
              clearHistory();
            }
            return next;
          });
        }}
      />

      <div className="main-panel">
      {/* Header */}
      <header className="header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            className="header-btn"
            onClick={() => setSidebarOpen((o) => !o)}
            title="Toggle sidebar"
          >
            ☰
          </button>
          <h1><span>🏠</span> Home AI</h1>
        </div>
        <div className="header-actions">
          <button
            className="header-btn"
            onClick={() => setVoiceEnabled(!voiceEnabled)}
            title={voiceEnabled ? "Disable auto-speak" : "Enable auto-speak"}
          >
            {voiceEnabled ? "🔊" : "🔇"}
          </button>
          <button
            className="header-btn"
            onClick={() => setShowLearning(!showLearning)}
            title="Learning & Memory"
          >
            🧠
          </button>
          <button
            className="header-btn"
            onClick={() => setShowKeyInput(!showKeyInput)}
          >
            ⚙️
          </button>
        </div>
      </header>

      {/* API Key input */}
      {showKeyInput && (
        <div
          style={{
            padding: "10px 20px",
            background: "var(--bg-secondary)",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <input
            type="password"
            placeholder="Enter API Key"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setApiKey(keyInput);
                setShowKeyInput(false);
              }
            }}
            style={{
              flex: 1,
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "8px 12px",
              color: "var(--text-primary)",
              fontFamily: "var(--font-mono)",
              fontSize: "0.85rem",
              outline: "none",
            }}
          />
          <button
            className="header-btn"
            onClick={() => {
              setApiKey(keyInput);
              setShowKeyInput(false);
            }}
          >
            Save
          </button>
        </div>
      )}

      {/* Learning Panel */}
      {showLearning && (
        <LearningPanel
          stats={learningStats}
          memories={memories}
          onRefresh={loadLearningData}
          onDeleteMemory={async (id) => {
            await deleteMemory(id);
            loadLearningData();
          }}
          onPause={async () => { await pauseLearning(); loadLearningData(); }}
          onResume={async () => { await resumeLearning(); loadLearningData(); }}
          onWipe={async () => {
            if (window.confirm("DANGER: This will permanently delete all learned data. Continue?")) {
              await wipeLearning();
              loadLearningData();
            }
          }}
          onClose={() => setShowLearning(false)}
        />
      )}

      {/* Messages or Welcome */}
      {messages.length === 0 ? (
        <div className="welcome">
          <h2>Welcome to Home AI</h2>
          <p>
            Your secure, local AI assistant. Ask me anything or request actions —
            all commands go through validation and approval before execution.
          </p>
          <div className="suggestions">
            {[
              "What's the system status?",
              "What time is it?",
              "List my documents",
              "Check server uptime via SSH",
            ].map((s) => (
              <button
                key={s}
                className="suggestion"
                onClick={() => {
                  setInput(s);
                  handleSend(s);
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="messages">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} onFeedback={handleFeedback} />
          ))}
          {isLoading && (
            <div className="message assistant">
              <div className="avatar">🤖</div>
              <div className="bubble">
                <div className="typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input Area */}
      <div className="input-area">
        <div className="input-row">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isRecording
                ? "Listening..."
                : "Type a message or click 🎤 to speak..."
            }
            rows={1}
            disabled={isLoading}
          />
          {isSupported && (
            <button
              className={`voice-btn ${isRecording ? "recording" : ""}`}
              onClick={toggleRecording}
              title={isRecording ? "Stop recording" : "Start voice input"}
            >
              🎤
            </button>
          )}
          <button
            className="send-btn"
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
          >
            ➤
          </button>
        </div>
        <div className="status-bar">
          <span>
            <span
              className={`status-dot ${isOnline ? "online" : "offline"}`}
            />
            {isOnline ? "Connected" : "Offline"}
          </span>
          <span>
            {messages.filter((m) => m.role === "user").length} messages
            {isRecording && " • 🔴 Recording"}
          </span>
        </div>
      </div>
      </div>
    </div>
  );
}

// ── Sidebar Component ──────────────────────────────────────────

function Sidebar({
  chats,
  activeChatId,
  isOpen,
  onSelect,
  onNew,
  onDelete,
}: {
  chats: Chat[];
  activeChatId: string | null;
  isOpen: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className={`sidebar${isOpen ? "" : " sidebar-closed"}`}>
      <div className="sidebar-header">
        <span className="sidebar-logo">🏠 Home AI</span>
        <button className="sidebar-new-btn" onClick={onNew} title="New chat">
          + New
        </button>
      </div>
      <nav className="sidebar-list">
        {chats.length === 0 ? (
          <p className="sidebar-empty">
            No chats yet.<br />Start a conversation!
          </p>
        ) : (
          chats.map((chat) => (
            <div
              key={chat.id}
              className={`sidebar-item${chat.id === activeChatId ? " active" : ""}`}
              onClick={() => onSelect(chat.id)}
              title={chat.title}
            >
              <div className="sidebar-item-body">
                <span className="sidebar-item-title">{chat.title}</span>
                <span className="sidebar-item-time">{formatTime(chat.updatedAt)}</span>
              </div>
              <button
                className="sidebar-item-del"
                onClick={(e) => { e.stopPropagation(); onDelete(chat.id); }}
                title="Delete chat"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </nav>
    </aside>
  );
}

// ── Learning Panel Component ───────────────────────────────

function LearningPanel({
  stats,
  memories,
  onRefresh,
  onDeleteMemory,
  onPause,
  onResume,
  onWipe,
  onClose,
}: {
  stats: LearningStats | null;
  memories: MemoryItem[];
  onRefresh: () => void;
  onDeleteMemory: (id: number) => void;
  onPause: () => void;
  onResume: () => void;
  onWipe: () => void;
  onClose: () => void;
}) {
  return (
    <div className="learning-panel">
      <div className="lp-header">
        <h3>🧠 Learning System</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="lp-btn" onClick={onRefresh} title="Refresh">🔄</button>
          <button className="lp-btn" onClick={onClose} title="Close">✕</button>
        </div>
      </div>

      {stats ? (
        <>
          <div className="lp-stats">
            <div className="lp-stat">
              <span className="lp-stat-val">{stats.db.memories}</span>
              <span className="lp-stat-lbl">Memories</span>
            </div>
            <div className="lp-stat">
              <span className="lp-stat-val">{stats.feedback.total}</span>
              <span className="lp-stat-lbl">Feedback</span>
            </div>
            <div className="lp-stat">
              <span className="lp-stat-val">
                {stats.feedback.total > 0
                  ? Math.round(stats.feedback.satisfaction_rate * 100) + "%"
                  : "—"}
              </span>
              <span className="lp-stat-lbl">Satisfaction</span>
            </div>
            <div className="lp-stat">
              <span className="lp-stat-val">{stats.db.conversation_summaries}</span>
              <span className="lp-stat-lbl">Sessions</span>
            </div>
          </div>

          <div className="lp-status">
            Status:{" "}
            <span style={{ color: !stats.enabled ? "var(--danger)" : "var(--accent)" }}>
              {!stats.enabled ? "⏸ Paused" : "▶ Active"}
            </span>
          </div>

          <div className="lp-controls">
            {!stats.enabled ? (
              <button className="lp-btn lp-btn-accent" onClick={onResume}>▶ Resume</button>
            ) : (
              <button className="lp-btn lp-btn-warn" onClick={onPause}>⏸ Pause</button>
            )}
            <button className="lp-btn lp-btn-danger" onClick={onWipe}>🗑 Wipe All</button>
          </div>

          <div className="lp-memories">
            <h4>Learned Memories ({memories.length})</h4>
            {memories.length === 0 ? (
              <p className="lp-empty">No memories yet. Chat and give feedback to teach me!</p>
            ) : (
              <ul className="lp-mem-list">
                {memories.map((m) => (
                  <li key={m.id} className="lp-mem-item">
                    <div className="lp-mem-content">
                      <span className="lp-mem-cat">{m.category}</span>
                      <span className="lp-mem-text">{m.value}</span>
                      <span className="lp-mem-conf">conf: {(m.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <button
                      className="lp-btn lp-btn-sm"
                      onClick={() => onDeleteMemory(m.id)}
                      title="Delete memory"
                    >✕</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <p style={{ textAlign: "center", color: "var(--text-muted)" }}>Loading…</p>
      )}
    </div>
  );
}

// ── Message Bubble Component ───────────────────────────────

function MessageBubble({ message, onFeedback }: { message: Message; onFeedback?: (id: string, score: -1 | 1) => void }) {
  if (message.role === "system") {
    return (
      <div
        className="message assistant"
        style={{ alignSelf: "center", maxWidth: "70%" }}
      >
        <div
          className="bubble"
          style={{
            background: "var(--bg-hover)",
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
            textAlign: "center",
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`message ${message.role}`}>
      <div className="avatar">
        {message.role === "user" ? "👤" : "🤖"}
      </div>
      <div>
        <div className="bubble">
          {message.content}
          {message.source === "voice" && (
            <span
              style={{
                marginLeft: 6,
                fontSize: "0.75rem",
                color: "var(--text-muted)",
              }}
            >
              🎤
            </span>
          )}
        </div>

        {/* Show command results */}
        {message.commands && message.commands.length > 0 && (
          <div className="command-results">
            {message.commands.map((cmd, i) => (
              <span
                key={i}
                className={`command-badge ${
                  cmd.approved ? "approved" : "denied"
                }`}
              >
                {cmd.approved ? "✓" : "✗"} {cmd.name}
                <span style={{ opacity: 0.7 }}>({cmd.risk})</span>
              </span>
            ))}
          </div>
        )}

        {/* Show execution results */}
        {message.execution_results &&
          message.execution_results.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary
                style={{
                  fontSize: "0.8rem",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                }}
              >
                Execution details
              </summary>
              <pre
                style={{
                  fontSize: "0.75rem",
                  background: "var(--bg-primary)",
                  padding: 8,
                  borderRadius: "var(--radius-sm)",
                  marginTop: 4,
                  overflow: "auto",
                  maxHeight: 200,
                  color: "var(--text-secondary)",
                }}
              >
                {JSON.stringify(message.execution_results, null, 2)}
              </pre>
            </details>
          )}

        {/* Feedback buttons for assistant messages */}
        {message.role === "assistant" && onFeedback && (
          <div className="feedback-btns">
            <button
              className={`fb-btn${message.feedback === 1 ? " active-up" : ""}`}
              title="Helpful"
              onClick={() => onFeedback(message.id, 1)}
            >👍</button>
            <button
              className={`fb-btn${message.feedback === -1 ? " active-down" : ""}`}
              title="Not helpful"
              onClick={() => onFeedback(message.id, -1)}
            >👎</button>
          </div>
        )}
      </div>
    </div>
  );
}
