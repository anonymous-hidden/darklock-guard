// ============================================================
// Home AI Assistant — API Client
// Communicates with the FastAPI backend
// ============================================================

// In dev, Vite proxies /api/* → the backend (stripping /api prefix).
// In production, the frontend is served by the same FastAPI server, so
// requests go directly to the root path with no prefix needed.
const API_BASE = import.meta.env.DEV ? "/api" : "";

let apiKey = localStorage.getItem("home_ai_api_key") || "";

export function setApiKey(key: string) {
  apiKey = key;
  localStorage.setItem("home_ai_api_key", key);
}

export function getApiKey(): string {
  return apiKey;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  const resp = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text}`);
  }

  return resp.json();
}

// ── Types ──────────────────────────────────────────────────

export interface ChatResult {
  reply: string;
  commands: Array<{
    name: string;
    risk: string;
    approved: boolean;
  }>;
  execution_results: Array<{
    command: string;
    approved: boolean;
    success?: boolean;
    result?: unknown;
    error?: string;
  }>;
}

export interface CommandInfo {
  name: string;
  risk: string;
  description: string;
}

// ── API calls ──────────────────────────────────────────────

export async function sendMessage(message: string): Promise<ChatResult> {
  return request<ChatResult>("/chat", {
    method: "POST",
    body: JSON.stringify({ message, source: "web" }),
  });
}

export async function healthCheck(): Promise<{
  status: string;
  uptime_seconds: number;
}> {
  // Health endpoint doesn't need auth
  const resp = await fetch(`${API_BASE}/health`);
  return resp.json();
}

export async function listCommands(): Promise<CommandInfo[]> {
  const data = await request<{ commands: CommandInfo[] }>("/commands");
  return data.commands;
}

export async function clearHistory(): Promise<void> {
  await request("/clear", { method: "POST" });
}

// ── Learning / Feedback APIs ───────────────────────────────

export async function submitFeedback(
  messageId: string,
  rating: number,
  userMessage: string,
  aiResponse: string,
  correction: string = ""
): Promise<void> {
  await request("/feedback", {
    method: "POST",
    body: JSON.stringify({
      message_id: messageId,
      rating,
      user_message: userMessage,
      ai_response: aiResponse,
      correction,
    }),
  });
}

export async function learnFact(
  key: string,
  value: string,
  category: string = "fact"
): Promise<void> {
  await request("/learn", {
    method: "POST",
    body: JSON.stringify({ key, value, category }),
  });
}

export interface LearningStats {
  enabled: boolean;
  session_id: string;
  messages_this_session: number;
  session_topics: string[];
  db: {
    memories: number;
    feedback_entries: number;
    command_outcomes: number;
    conversation_summaries: number;
  };
  feedback: {
    total: number;
    positive: number;
    negative: number;
    satisfaction_rate: number;
  };
}

export async function getLearningStats(): Promise<LearningStats> {
  return request<LearningStats>("/learning/stats");
}

export interface MemoryItem {
  id: number;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
  created_at: string;
  updated_at: string;
  access_count: number;
}

export async function getLearningMemories(
  category?: string
): Promise<MemoryItem[]> {
  const params = category ? `?category=${encodeURIComponent(category)}` : "";
  const data = await request<{ memories: MemoryItem[] }>(
    `/learning/memories${params}`
  );
  return data.memories;
}

export async function deleteMemory(id: number): Promise<void> {
  await request(`/learning/memories/${id}`, { method: "DELETE" });
}

export async function pauseLearning(): Promise<void> {
  await request("/learning/pause", { method: "POST" });
}

export async function resumeLearning(): Promise<void> {
  await request("/learning/resume", { method: "POST" });
}

export async function wipeLearning(): Promise<void> {
  await request("/learning/wipe", { method: "POST" });
}
