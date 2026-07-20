/**
 * Moderation Commands — /kick, /ban, /timeout, /warn, /lock, /lockdown, etc.
 *
 * Backend logic:
 * - Permission overrides: When /lock is used, it sets SEND_MESSAGES deny override
 *   for @everyone role on the target channel, then adds SEND_MESSAGES allow
 *   override for the specified role. Only admins and that role can send messages.
 * - Temporary punishments: /timeout and /ban with duration use scheduled tasks.
 *   The frontend records expires_at and a background interval checks for expiry.
 * - Audit integration: Every action is logged to the server audit log with
 *   actor, target, action type, reason, and timestamp.
 */

import { registerCommand, type CommandHandler } from "@/lib/commandRegistry";
import type { SlashCommand } from "@/types";
import { Permissions } from "@/types";

// ── Helper: parse duration string like "1h", "30m", "7d" ───────────────────

export function parseDuration(input: string): number | null {
  const match = input.match(/^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day|w|week)s?$/i);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case "s": case "sec": return num * 1000;
    case "m": case "min": return num * 60 * 1000;
    case "h": case "hr": case "hour": return num * 60 * 60 * 1000;
    case "d": case "day": return num * 24 * 60 * 60 * 1000;
    case "w": case "week": return num * 7 * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

// ── /kick ───────────────────────────────────────────────────────────────────

const kickCommand: SlashCommand = {
  name: "kick",
  description: "Kick a member from the server",
  category: "moderation",
  params: [
    { name: "user", description: "User to kick", type: "user", required: true },
    { name: "reason", description: "Reason for kick", type: "string", required: false },
  ],
  permissions: Permissions.KICK_MEMBERS,
  serverOnly: true,
  dangerous: true,
};

const kickHandler: CommandHandler = async (args, _ctx) => {
  const user = args.user;
  const reason = args.reason ?? "No reason provided";
  // In production, this would call api.kickMember(ctx.serverId, user, reason)
  return {
    success: true,
    message: `**${user}** has been kicked. Reason: ${reason}`,
    ephemeral: false,
    data: { action: "kick", targetUser: user, reason },
  };
};

// ── /ban ────────────────────────────────────────────────────────────────────

const banCommand: SlashCommand = {
  name: "ban",
  description: "Ban a member from the server",
  category: "moderation",
  params: [
    { name: "user", description: "User to ban", type: "user", required: true },
    { name: "reason", description: "Reason for ban", type: "string", required: false },
    { name: "duration", description: "Ban duration (e.g., 7d, 1h). Omit for permanent", type: "duration", required: false },
  ],
  permissions: Permissions.BAN_MEMBERS,
  serverOnly: true,
  dangerous: true,
};

const banHandler: CommandHandler = async (args, _ctx) => {
  const user = args.user;
  const reason = args.reason ?? "No reason provided";
  const duration = args.duration ? parseDuration(args.duration) : null;
  const durationStr = duration ? args.duration : "permanent";
  return {
    success: true,
    message: `**${user}** has been banned (${durationStr}). Reason: ${reason}`,
    ephemeral: false,
    data: { action: "ban", targetUser: user, reason, durationMs: duration },
  };
};

// ── /unban ──────────────────────────────────────────────────────────────────

const unbanCommand: SlashCommand = {
  name: "unban",
  description: "Unban a member from the server",
  category: "moderation",
  params: [
    { name: "user", description: "User to unban", type: "user", required: true },
  ],
  permissions: Permissions.BAN_MEMBERS,
  serverOnly: true,
};

const unbanHandler: CommandHandler = async (args) => {
  return {
    success: true,
    message: `**${args.user}** has been unbanned.`,
    ephemeral: false,
    data: { action: "unban", targetUser: args.user },
  };
};

// ── /timeout ────────────────────────────────────────────────────────────────

const timeoutCommand: SlashCommand = {
  name: "timeout",
  description: "Temporarily mute a member",
  category: "moderation",
  params: [
    { name: "user", description: "User to timeout", type: "user", required: true },
    { name: "duration", description: "Timeout duration (e.g., 10m, 1h)", type: "duration", required: true },
    { name: "reason", description: "Reason for timeout", type: "string", required: false },
  ],
  permissions: Permissions.KICK_MEMBERS,
  serverOnly: true,
};

const timeoutHandler: CommandHandler = async (args) => {
  const duration = parseDuration(args.duration);
  if (!duration) return { success: false, message: "Invalid duration format. Use: 10m, 1h, 7d", ephemeral: true };
  return {
    success: true,
    message: `**${args.user}** has been timed out for ${args.duration}. Reason: ${args.reason ?? "No reason"}`,
    ephemeral: false,
    data: { action: "timeout", targetUser: args.user, durationMs: duration },
  };
};

// ── /warn ───────────────────────────────────────────────────────────────────

const warnCommand: SlashCommand = {
  name: "warn",
  description: "Issue a warning to a member",
  category: "moderation",
  params: [
    { name: "user", description: "User to warn", type: "user", required: true },
    { name: "reason", description: "Reason for warning", type: "string", required: true },
  ],
  permissions: Permissions.KICK_MEMBERS,
  serverOnly: true,
};

const warnHandler: CommandHandler = async (args, ctx) => {
  return {
    success: true,
    message: `⚠️ **${args.user}** has been warned. Reason: ${args.reason}`,
    ephemeral: false,
    data: { action: "warn", targetUser: args.user, reason: args.reason, moderator: ctx.username },
  };
};

// ── /warnings ───────────────────────────────────────────────────────────────

const warningsCommand: SlashCommand = {
  name: "warnings",
  description: "View warnings for a member",
  category: "moderation",
  params: [
    { name: "user", description: "User to check", type: "user", required: true },
  ],
  permissions: Permissions.KICK_MEMBERS,
  serverOnly: true,
  ephemeral: true,
};

const warningsHandler: CommandHandler = async (args) => {
  return {
    success: true,
    message: `Warnings for **${args.user}**: Loading...`,
    ephemeral: true,
    data: { action: "warnings", targetUser: args.user },
  };
};

// ── /clear ──────────────────────────────────────────────────────────────────

const clearCommand: SlashCommand = {
  name: "clear",
  description: "Delete multiple messages from a channel",
  category: "moderation",
  params: [
    { name: "amount", description: "Number of messages to delete (1-100)", type: "number", required: true },
  ],
  permissions: Permissions.MANAGE_MESSAGES,
  serverOnly: true,
  dangerous: true,
};

const clearHandler: CommandHandler = async (args) => {
  const amount = parseInt(args.amount, 10);
  if (amount < 1 || amount > 100) return { success: false, message: "Amount must be between 1 and 100.", ephemeral: true };
  return {
    success: true,
    message: `🗑️ Deleted ${amount} message(s).`,
    ephemeral: true,
    data: { action: "clear", amount },
  };
};

// ── /slowmode ───────────────────────────────────────────────────────────────

const slowmodeCommand: SlashCommand = {
  name: "slowmode",
  description: "Set slow mode for the current channel",
  category: "moderation",
  params: [
    { name: "duration", description: "Slow mode duration (0 to disable, e.g., 5s, 30s, 1m)", type: "duration", required: true },
  ],
  permissions: Permissions.MANAGE_CHANNELS,
  serverOnly: true,
};

const slowmodeHandler: CommandHandler = async (args) => {
  if (args.duration === "0" || args.duration === "off") {
    return { success: true, message: "Slow mode disabled.", ephemeral: false };
  }
  const duration = parseDuration(args.duration);
  if (!duration) return { success: false, message: "Invalid duration.", ephemeral: true };
  return {
    success: true,
    message: `🐌 Slow mode set to ${args.duration}.`,
    ephemeral: false,
    data: { action: "slowmode", durationMs: duration },
  };
};

// ── /lock ───────────────────────────────────────────────────────────────────
// Permission override logic:
// 1. Deny SEND_MESSAGES for @everyone (role_id = server_id)
// 2. Allow SEND_MESSAGES for specified role
// 3. Admins always bypass (is_admin = true on their role)
// This effectively locks the channel to only the specified role + admins.

const lockCommand: SlashCommand = {
  name: "lock",
  description: "Lock a channel to a specific role",
  category: "moderation",
  params: [
    { name: "channel", description: "Channel to lock (default: current)", type: "channel", required: false },
    { name: "role", description: "Role that can still send messages", type: "role", required: false },
  ],
  permissions: Permissions.MANAGE_CHANNELS,
  serverOnly: true,
};

const lockHandler: CommandHandler = async (args, ctx) => {
  const channel = args.channel ?? ctx.channelId ?? "this channel";
  const role = args.role ?? "none";
  return {
    success: true,
    message: `🔒 **${channel}** has been locked.${role !== "none" ? ` Only **${role}** can send messages.` : ""}`,
    ephemeral: false,
    data: { action: "lock", channel, role },
  };
};

// ── /unlock ─────────────────────────────────────────────────────────────────

const unlockCommand: SlashCommand = {
  name: "unlock",
  description: "Unlock a previously locked channel",
  category: "moderation",
  params: [
    { name: "channel", description: "Channel to unlock (default: current)", type: "channel", required: false },
  ],
  permissions: Permissions.MANAGE_CHANNELS,
  serverOnly: true,
};

const unlockHandler: CommandHandler = async (args, ctx) => {
  const channel = args.channel ?? ctx.channelId ?? "this channel";
  return {
    success: true,
    message: `🔓 **${channel}** has been unlocked.`,
    ephemeral: false,
    data: { action: "unlock", channel },
  };
};

// ── /mute ───────────────────────────────────────────────────────────────────

const muteCommand: SlashCommand = {
  name: "mute",
  description: "Mute a member in the server",
  category: "moderation",
  params: [
    { name: "user", description: "User to mute", type: "user", required: true },
    { name: "duration", description: "Mute duration (e.g., 10m, 1h)", type: "duration", required: false },
  ],
  permissions: Permissions.KICK_MEMBERS,
  serverOnly: true,
};

const muteHandler: CommandHandler = async (args) => {
  const duration = args.duration ? parseDuration(args.duration) : null;
  return {
    success: true,
    message: `🔇 **${args.user}** has been muted${duration ? ` for ${args.duration}` : ""}.`,
    ephemeral: false,
    data: { action: "mute", targetUser: args.user, durationMs: duration },
  };
};

// ── /unmute ─────────────────────────────────────────────────────────────────

const unmuteCommand: SlashCommand = {
  name: "unmute",
  description: "Unmute a member in the server",
  category: "moderation",
  params: [
    { name: "user", description: "User to unmute", type: "user", required: true },
  ],
  permissions: Permissions.KICK_MEMBERS,
  serverOnly: true,
};

const unmuteHandler: CommandHandler = async (args) => {
  return {
    success: true,
    message: `🔊 **${args.user}** has been unmuted.`,
    ephemeral: false,
    data: { action: "unmute", targetUser: args.user },
  };
};

// ── /role ───────────────────────────────────────────────────────────────────

const roleCommand: SlashCommand = {
  name: "role",
  description: "Add or remove a role from a user",
  category: "moderation",
  params: [
    { name: "action", description: "add or remove", type: "string", required: true, choices: [{ name: "Add", value: "add" }, { name: "Remove", value: "remove" }] },
    { name: "user", description: "Target user", type: "user", required: true },
    { name: "role", description: "Role to add/remove", type: "role", required: true },
  ],
  permissions: Permissions.MANAGE_ROLES,
  serverOnly: true,
};

const roleHandler: CommandHandler = async (args) => {
  const action = args.action === "add" ? "added to" : "removed from";
  return {
    success: true,
    message: `Role **${args.role}** ${action} **${args.user}**.`,
    ephemeral: false,
    data: { action: `role_${args.action}`, targetUser: args.user, role: args.role },
  };
};

// ── /nickname ───────────────────────────────────────────────────────────────

const nicknameCommand: SlashCommand = {
  name: "nickname",
  description: "Change a member's nickname",
  category: "moderation",
  params: [
    { name: "user", description: "User to rename", type: "user", required: true },
    { name: "name", description: "New nickname (leave empty to reset)", type: "string", required: false },
  ],
  permissions: Permissions.MANAGE_ROLES,
  serverOnly: true,
};

const nicknameHandler: CommandHandler = async (args) => {
  const name = args.name ?? null;
  return {
    success: true,
    message: name ? `Nickname for **${args.user}** set to **${name}**.` : `Nickname for **${args.user}** has been reset.`,
    ephemeral: false,
    data: { action: "nickname", targetUser: args.user, nickname: name },
  };
};

// ── /purge ──────────────────────────────────────────────────────────────────

const purgeCommand: SlashCommand = {
  name: "purge",
  description: "Delete messages from a specific user",
  category: "moderation",
  params: [
    { name: "user", description: "User whose messages to delete", type: "user", required: true },
    { name: "amount", description: "Number of messages to check (1-100)", type: "number", required: true },
  ],
  permissions: Permissions.MANAGE_MESSAGES,
  serverOnly: true,
  dangerous: true,
};

const purgeHandler: CommandHandler = async (args) => {
  const amount = parseInt(args.amount, 10);
  if (amount < 1 || amount > 100) return { success: false, message: "Amount must be between 1 and 100.", ephemeral: true };
  return {
    success: true,
    message: `🗑️ Purged up to ${amount} messages from **${args.user}**.`,
    ephemeral: true,
    data: { action: "purge", targetUser: args.user, amount },
  };
};

// ── /lockdown ───────────────────────────────────────────────────────────────

const lockdownCommand: SlashCommand = {
  name: "lockdown",
  description: "Lock the entire server — disable sending in all channels",
  category: "moderation",
  params: [
    { name: "reason", description: "Reason for lockdown", type: "string", required: false },
  ],
  permissions: Permissions.ADMINISTRATOR,
  serverOnly: true,
  dangerous: true,
};

const lockdownHandler: CommandHandler = async (args) => {
  return {
    success: true,
    message: `🚨 **SERVER LOCKDOWN ACTIVATED**${args.reason ? ` — ${args.reason}` : ""}. All channels have been locked. Use /unlockdown to restore.`,
    ephemeral: false,
    data: { action: "lockdown", reason: args.reason },
  };
};

// ── /unlockdown ─────────────────────────────────────────────────────────────

const unlockdownCommand: SlashCommand = {
  name: "unlockdown",
  description: "Lift server lockdown — restore channel permissions",
  category: "moderation",
  params: [],
  permissions: Permissions.ADMINISTRATOR,
  serverOnly: true,
  dangerous: true,
};

const unlockdownHandler: CommandHandler = async () => {
  return {
    success: true,
    message: `✅ Server lockdown has been lifted. Normal permissions restored.`,
    ephemeral: false,
    data: { action: "unlockdown" },
  };
};

// ── Registration ────────────────────────────────────────────────────────────

export function registerModerationCommands(): void {
  registerCommand(kickCommand, kickHandler);
  registerCommand(banCommand, banHandler);
  registerCommand(unbanCommand, unbanHandler);
  registerCommand(timeoutCommand, timeoutHandler);
  registerCommand(warnCommand, warnHandler);
  registerCommand(warningsCommand, warningsHandler);
  registerCommand(clearCommand, clearHandler);
  registerCommand(slowmodeCommand, slowmodeHandler);
  registerCommand(lockCommand, lockHandler);
  registerCommand(unlockCommand, unlockHandler);
  registerCommand(muteCommand, muteHandler);
  registerCommand(unmuteCommand, unmuteHandler);
  registerCommand(roleCommand, roleHandler);
  registerCommand(nicknameCommand, nicknameHandler);
  registerCommand(purgeCommand, purgeHandler);
  registerCommand(lockdownCommand, lockdownHandler);
  registerCommand(unlockdownCommand, unlockdownHandler);
}
