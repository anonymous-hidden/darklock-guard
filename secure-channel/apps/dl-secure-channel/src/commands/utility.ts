/**
 * Utility Commands — /userinfo, /serverinfo, /ping, /help, /poll, /remind, etc.
 */

import { registerCommand, getAllCommands, type CommandHandler } from "@/lib/commandRegistry";
import type { SlashCommand, CommandCategory } from "@/types";

// ── /ping ───────────────────────────────────────────────────────────────────

const pingCommand: SlashCommand = {
  name: "ping",
  description: "Check bot latency",
  category: "utility",
  params: [],
};

const pingHandler: CommandHandler = async () => {
  const start = performance.now();
  // Simulate a round-trip
  await new Promise((r) => setTimeout(r, 1));
  const ms = Math.round(performance.now() - start);
  return { success: true, message: `🏓 Pong! Latency: **${ms}ms**`, ephemeral: true };
};

// ── /help ───────────────────────────────────────────────────────────────────

const helpCommand: SlashCommand = {
  name: "help",
  description: "Show available commands",
  category: "utility",
  params: [
    { name: "command", description: "Specific command to get help for", type: "string", required: false },
  ],
};

const CATEGORY_EMOJI: Record<CommandCategory, string> = {
  moderation: "🛡️",
  fun: "🎮",
  utility: "🔧",
  server: "⚙️",
  security: "🔒",
};

const helpHandler: CommandHandler = async (args) => {
  if (args.command) {
    const cmd = getAllCommands().find((c) => c.name === args.command);
    if (!cmd) return { success: false, message: `Unknown command: /${args.command}`, ephemeral: true };

    const params = cmd.params.map((p) =>
      `  \`${p.required ? "<" : "["}${p.name}${p.required ? ">" : "]"}\` — ${p.description}${p.choices ? ` (${p.choices.map((c) => c.name).join(", ")})` : ""}`
    ).join("\n");

    return {
      success: true,
      message: `**/${cmd.name}** — ${cmd.description}\n${CATEGORY_EMOJI[cmd.category]} ${cmd.category}\n${params || "  No parameters"}${cmd.cooldownMs ? `\n⏱️ Cooldown: ${cmd.cooldownMs / 1000}s` : ""}${cmd.dangerous ? "\n⚠️ Requires confirmation" : ""}`,
      ephemeral: true,
    };
  }

  const commands = getAllCommands();
  const byCategory = new Map<CommandCategory, SlashCommand[]>();
  for (const cmd of commands) {
    const list = byCategory.get(cmd.category) ?? [];
    list.push(cmd);
    byCategory.set(cmd.category, list);
  }

  let msg = "**📖 Darklock Commands**\n";
  for (const [cat, cmds] of byCategory) {
    msg += `\n${CATEGORY_EMOJI[cat]} **${cat.charAt(0).toUpperCase() + cat.slice(1)}**\n`;
    msg += cmds.map((c) => `  \`/${c.name}\` — ${c.description}`).join("\n");
    msg += "\n";
  }
  msg += "\nUse `/help <command>` for detailed info.";

  return { success: true, message: msg, ephemeral: true };
};

// ── /userinfo ───────────────────────────────────────────────────────────────

const userinfoCommand: SlashCommand = {
  name: "userinfo",
  description: "View information about a user",
  category: "utility",
  params: [
    { name: "user", description: "User to lookup (default: yourself)", type: "user", required: false },
  ],
};

const userinfoHandler: CommandHandler = async (args, ctx) => {
  const user = args.user ?? ctx.username;
  return {
    success: true,
    message: `👤 **User Info for ${user}**\n_Loading profile data..._`,
    ephemeral: true,
    data: { action: "userinfo", targetUser: user },
  };
};

// ── /serverinfo ─────────────────────────────────────────────────────────────

const serverinfoCommand: SlashCommand = {
  name: "serverinfo",
  description: "View server information",
  category: "utility",
  params: [],
  serverOnly: true,
};

const serverinfoHandler: CommandHandler = async (_args, ctx) => {
  return {
    success: true,
    message: `🏠 **Server Info**\n_Loading server data..._`,
    ephemeral: true,
    data: { action: "serverinfo", serverId: ctx.serverId },
  };
};

// ── /roleinfo ───────────────────────────────────────────────────────────────

const roleinfoCommand: SlashCommand = {
  name: "roleinfo",
  description: "View information about a role",
  category: "utility",
  params: [
    { name: "role", description: "Role to lookup", type: "role", required: true },
  ],
  serverOnly: true,
};

const roleinfoHandler: CommandHandler = async (args) => {
  return {
    success: true,
    message: `🏷️ **Role Info: ${args.role}**\n_Loading role data..._`,
    ephemeral: true,
    data: { action: "roleinfo", role: args.role },
  };
};

// ── /avatar ─────────────────────────────────────────────────────────────────

const avatarCommand: SlashCommand = {
  name: "avatar",
  description: "View a user's avatar",
  category: "utility",
  params: [
    { name: "user", description: "User to lookup (default: yourself)", type: "user", required: false },
  ],
};

const avatarHandler: CommandHandler = async (args, ctx) => {
  const user = args.user ?? ctx.username;
  return {
    success: true,
    message: `🖼️ **Avatar for ${user}**\n_Loading avatar..._`,
    ephemeral: true,
    data: { action: "avatar", targetUser: user },
  };
};

// ── /invite ─────────────────────────────────────────────────────────────────

const inviteCommand: SlashCommand = {
  name: "invite",
  description: "Generate a server invite link",
  category: "utility",
  params: [
    { name: "expires", description: "Expiration time (e.g., 1h, 1d, 7d, never)", type: "string", required: false },
    { name: "max_uses", description: "Maximum number of uses", type: "number", required: false },
  ],
  serverOnly: true,
};

const inviteHandler: CommandHandler = async (args, ctx) => {
  return {
    success: true,
    message: `🔗 **Invite Created**\n_Generating invite link..._`,
    ephemeral: true,
    data: { action: "invite", serverId: ctx.serverId, expires: args.expires, maxUses: args.max_uses },
  };
};

// ── /report ─────────────────────────────────────────────────────────────────

const reportCommand: SlashCommand = {
  name: "report",
  description: "Report a user for rule violation",
  category: "utility",
  params: [
    { name: "user", description: "User to report", type: "user", required: true },
    { name: "reason", description: "Reason for report", type: "string", required: true },
  ],
  ephemeral: true,
};

const reportHandler: CommandHandler = async (args, ctx) => {
  return {
    success: true,
    message: `📨 Report submitted for **${args.user}**. Reason: ${args.reason}\n_Moderators will review this report._`,
    ephemeral: true,
    data: { action: "report", targetUser: args.user, reason: args.reason, reportedBy: ctx.username },
  };
};

// ── /remind ─────────────────────────────────────────────────────────────────

const remindCommand: SlashCommand = {
  name: "remind",
  description: "Set a reminder",
  category: "utility",
  params: [
    { name: "duration", description: "When to remind (e.g., 10m, 1h, 1d)", type: "duration", required: true },
    { name: "message", description: "Reminder message", type: "string", required: true },
  ],
};

const remindHandler: CommandHandler = async (args) => {
  return {
    success: true,
    message: `⏰ Reminder set for **${args.duration}** from now: ${args.message}`,
    ephemeral: true,
    data: { action: "remind", duration: args.duration, message: args.message },
  };
};

// ── /poll ────────────────────────────────────────────────────────────────────

const pollCommand: SlashCommand = {
  name: "poll",
  description: "Create a poll",
  category: "utility",
  params: [
    { name: "question", description: "Poll question", type: "string", required: true },
    { name: "options", description: "Options separated by | (e.g., Yes | No | Maybe)", type: "string", required: false },
  ],
  cooldownMs: 30000,
};

const POLL_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

const pollHandler: CommandHandler = async (args) => {
  const options = args.options
    ? args.options.split("|").map((o) => o.trim()).filter(Boolean)
    : ["Yes", "No"];

  if (options.length < 2) return { success: false, message: "A poll needs at least 2 options.", ephemeral: true };
  if (options.length > 10) return { success: false, message: "Maximum 10 options.", ephemeral: true };

  let msg = `📊 **Poll: ${args.question}**\n\n`;
  options.forEach((opt, i) => {
    msg += `${POLL_EMOJI[i]} ${opt}\n`;
  });
  msg += "\n_React with the corresponding emoji to vote!_";

  return { success: true, message: msg, ephemeral: false };
};

// ── Registration ────────────────────────────────────────────────────────────

export function registerUtilityCommands(): void {
  registerCommand(pingCommand, pingHandler);
  registerCommand(helpCommand, helpHandler);
  registerCommand(userinfoCommand, userinfoHandler);
  registerCommand(serverinfoCommand, serverinfoHandler);
  registerCommand(roleinfoCommand, roleinfoHandler);
  registerCommand(avatarCommand, avatarHandler);
  registerCommand(inviteCommand, inviteHandler);
  registerCommand(reportCommand, reportHandler);
  registerCommand(remindCommand, remindHandler);
  registerCommand(pollCommand, pollHandler);
}
