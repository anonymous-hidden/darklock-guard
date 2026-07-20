/**
 * commandRegistry — Slash command registration, parsing, execution, and rate limiting.
 *
 * Architecture:
 * 1. Commands register via `registerCommand(cmd, handler)`
 * 2. Input is parsed by `parseCommandInput(text)` → { name, args }
 * 3. `executeCommand(name, args, ctx)` validates permissions, cooldowns, then invokes handler
 * 4. Results are logged to audit log via the store
 *
 * Permission validation flow:
 *   User input → Parse → Check command exists → Check permissions → Check cooldown →
 *   Check rate limit → Execute handler → Log result → Return response
 */

import type {
  SlashCommand,
  CommandResult,
  CommandCategory,
} from "@/types";

// ── Command Handler Type ────────────────────────────────────────────────────

export type CommandHandler = (
  args: Record<string, string>,
  ctx: CommandContext,
) => Promise<CommandResult>;

export interface CommandContext {
  userId: string;
  username: string;
  serverId?: string;
  channelId?: string;
  sessionId?: string;
  userPermissions: number;
  userRoles: string[];
  isOwner: boolean;
  isAdmin: boolean;
}

// ── Registry ────────────────────────────────────────────────────────────────

interface RegisteredCommand {
  command: SlashCommand;
  handler: CommandHandler;
}

const _commands = new Map<string, RegisteredCommand>();
const _cooldowns = new Map<string, number>(); // `userId:commandName` → expiry timestamp
const _rateLimits = new Map<string, number[]>(); // userId → timestamps of recent commands

// Rate limit: max 10 commands per 30 seconds per user
const RATE_LIMIT_WINDOW = 30_000;
const RATE_LIMIT_MAX = 10;

export function registerCommand(command: SlashCommand, handler: CommandHandler): void {
  _commands.set(command.name, { command, handler });
}

export function getCommand(name: string): RegisteredCommand | undefined {
  return _commands.get(name);
}

export function getAllCommands(): SlashCommand[] {
  return Array.from(_commands.values()).map((r) => r.command);
}

export function getCommandsByCategory(category: CommandCategory): SlashCommand[] {
  return getAllCommands().filter((c) => c.category === category);
}

/** Autocomplete: returns matching commands for partial input */
export function getAutocompleteSuggestions(
  partial: string,
  ctx: CommandContext,
): SlashCommand[] {
  const lower = partial.toLowerCase().replace(/^\//, "");
  return getAllCommands()
    .filter((cmd) => {
      // Filter by name match
      if (!cmd.name.startsWith(lower) && !cmd.description.toLowerCase().includes(lower)) {
        return false;
      }
      // Filter by server-only
      if (cmd.serverOnly && !ctx.serverId) return false;
      // Filter by permissions
      if (cmd.permissions && !ctx.isAdmin && !ctx.isOwner) {
        if ((ctx.userPermissions & cmd.permissions) !== cmd.permissions) return false;
      }
      return true;
    })
    .slice(0, 8);
}

// ── Parsing ─────────────────────────────────────────────────────────────────

export interface ParsedCommand {
  name: string;
  args: Record<string, string>;
  raw: string;
}

/**
 * Parse slash command input.
 * Supports: /command param1 param2 "multi word param"
 * Named params: /command user:@someone reason:Being rude
 */
export function parseCommandInput(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const parts = tokenize(trimmed.slice(1));
  if (parts.length === 0) return null;

  const name = parts[0].toLowerCase();
  const cmd = _commands.get(name);
  if (!cmd) return null;

  const args: Record<string, string> = {};
  const params = cmd.command.params;

  // Try named parameters first (key:value)
  let positionalIndex = 0;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const colonIdx = part.indexOf(":");
    if (colonIdx > 0 && !part.startsWith('"')) {
      const key = part.slice(0, colonIdx);
      const value = part.slice(colonIdx + 1);
      args[key] = value;
    } else {
      // Positional parameter
      if (positionalIndex < params.length) {
        args[params[positionalIndex].name] = part;
        positionalIndex++;
      }
    }
  }

  return { name, args, raw: trimmed };
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;

  for (const char of input) {
    if (char === '"') {
      inQuote = !inQuote;
    } else if (char === " " && !inQuote) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

// ── Validation ──────────────────────────────────────────────────────────────

function validateParams(
  cmd: SlashCommand,
  args: Record<string, string>,
): string | null {
  for (const param of cmd.params) {
    if (param.required && !(param.name in args)) {
      return `Missing required parameter: ${param.name}`;
    }
    if (param.name in args) {
      const val = args[param.name];
      if (param.type === "number" && isNaN(Number(val))) {
        return `Parameter "${param.name}" must be a number`;
      }
      if (param.type === "boolean" && !["true", "false", "yes", "no", "1", "0"].includes(val.toLowerCase())) {
        return `Parameter "${param.name}" must be true/false`;
      }
      if (param.choices && !param.choices.some((c) => c.value === val)) {
        return `Parameter "${param.name}" must be one of: ${param.choices.map((c) => c.name).join(", ")}`;
      }
    }
  }
  return null;
}

function checkCooldown(userId: string, commandName: string, _cooldownMs: number): number | null {
  const key = `${userId}:${commandName}`;
  const expiresAt = _cooldowns.get(key);
  if (expiresAt && Date.now() < expiresAt) {
    return expiresAt - Date.now();
  }
  return null;
}

function setCooldown(userId: string, commandName: string, cooldownMs: number): void {
  const key = `${userId}:${commandName}`;
  _cooldowns.set(key, Date.now() + cooldownMs);
}

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = _rateLimits.get(userId) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);
  _rateLimits.set(userId, recent);
  return recent.length < RATE_LIMIT_MAX;
}

function recordRateLimit(userId: string): void {
  const timestamps = _rateLimits.get(userId) ?? [];
  timestamps.push(Date.now());
  _rateLimits.set(userId, timestamps);
}

// ── Execution ───────────────────────────────────────────────────────────────

export async function executeCommand(
  name: string,
  args: Record<string, string>,
  ctx: CommandContext,
): Promise<CommandResult> {
  const registered = _commands.get(name);
  if (!registered) {
    return { success: false, message: `Unknown command: /${name}`, ephemeral: true, error: "unknown_command" };
  }

  const { command, handler } = registered;

  // Server-only check
  if (command.serverOnly && !ctx.serverId) {
    return { success: false, message: "This command can only be used in a server.", ephemeral: true, error: "server_only" };
  }

  // Permission check
  if (command.permissions && !ctx.isOwner) {
    if (!ctx.isAdmin && (ctx.userPermissions & command.permissions) !== command.permissions) {
      return { success: false, message: "You don't have permission to use this command.", ephemeral: true, error: "permission_denied" };
    }
  }

  // Role restriction check
  if (command.roleRestrictions && command.roleRestrictions.length > 0) {
    if (!ctx.isOwner && !ctx.isAdmin) {
      const hasRole = command.roleRestrictions.some((r) => ctx.userRoles.includes(r));
      if (!hasRole) {
        return { success: false, message: "You don't have the required role to use this command.", ephemeral: true, error: "role_denied" };
      }
    }
  }

  // Rate limit check
  if (!checkRateLimit(ctx.userId)) {
    return { success: false, message: "You're sending commands too fast. Please slow down.", ephemeral: true, error: "rate_limited" };
  }

  // Cooldown check
  if (command.cooldownMs) {
    const remaining = checkCooldown(ctx.userId, name, command.cooldownMs);
    if (remaining !== null) {
      const secs = Math.ceil(remaining / 1000);
      return { success: false, message: `Command on cooldown. Try again in ${secs}s.`, ephemeral: true, error: "cooldown" };
    }
  }

  // Param validation
  const paramError = validateParams(command, args);
  if (paramError) {
    return { success: false, message: paramError, ephemeral: true, error: "invalid_params" };
  }

  // Execute
  try {
    recordRateLimit(ctx.userId);
    const result = await handler(args, ctx);

    // Set cooldown on success
    if (command.cooldownMs && result.success) {
      setCooldown(ctx.userId, name, command.cooldownMs);
    }

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Command failed: ${msg}`, ephemeral: true, error: msg };
  }
}

// ── Command Usage Analytics ─────────────────────────────────────────────────

const _usageStats = new Map<string, number>();

export function getCommandUsage(): Record<string, number> {
  return Object.fromEntries(_usageStats);
}

export function recordCommandUsage(name: string): void {
  _usageStats.set(name, (_usageStats.get(name) ?? 0) + 1);
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

export function clearCooldowns(): void {
  _cooldowns.clear();
}

export function clearRateLimits(): void {
  _rateLimits.clear();
}
