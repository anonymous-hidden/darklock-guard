/**
 * Server Management Commands — /server, /channel, /role management via slash commands
 */

import { registerCommand, type CommandHandler } from "@/lib/commandRegistry";
import type { SlashCommand } from "@/types";
import { Permissions } from "@/types";

// ── /serverinfo (extended) ──────────────────────────────────────────────────

const serverCommand: SlashCommand = {
  name: "server",
  description: "Server management commands",
  category: "server",
  params: [
    { name: "action", description: "Action to perform", type: "string", required: true, choices: [
      { name: "Info", value: "info" },
      { name: "Edit Name", value: "edit-name" },
      { name: "Edit Description", value: "edit-desc" },
      { name: "Members", value: "members" },
      { name: "Channels", value: "channels" },
      { name: "Security", value: "security" },
    ]},
    { name: "value", description: "New value (for edit actions)", type: "string", required: false },
  ],
  permissions: Permissions.MANAGE_SERVER,
  serverOnly: true,
};

const serverHandler: CommandHandler = async (args, ctx) => {
  switch (args.action) {
    case "info":
      return { success: true, message: `🏠 **Server Info** — Loading...`, ephemeral: true, data: { action: "server_info", serverId: ctx.serverId } };
    case "edit-name":
      if (!args.value) return { success: false, message: "Provide a new server name.", ephemeral: true };
      return { success: true, message: `✅ Server name updated to **${args.value}**`, ephemeral: false, data: { action: "server_edit_name", name: args.value } };
    case "edit-desc":
      return { success: true, message: `✅ Server description updated.`, ephemeral: false, data: { action: "server_edit_desc", description: args.value } };
    case "members":
      return { success: true, message: `👥 **Member List** — Loading...`, ephemeral: true, data: { action: "server_members" } };
    case "channels":
      return { success: true, message: `📋 **Channel List** — Loading...`, ephemeral: true, data: { action: "server_channels" } };
    case "security":
      return { success: true, message: `🔒 **Security Settings** — Use the server settings panel for detailed configuration.`, ephemeral: true, data: { action: "server_security" } };
    default:
      return { success: false, message: `Unknown action: ${args.action}`, ephemeral: true };
  }
};

// ── /channel ────────────────────────────────────────────────────────────────

const channelCommand: SlashCommand = {
  name: "channel",
  description: "Channel management commands",
  category: "server",
  params: [
    { name: "action", description: "Action to perform", type: "string", required: true, choices: [
      { name: "Create", value: "create" },
      { name: "Delete", value: "delete" },
      { name: "Topic", value: "topic" },
      { name: "Rename", value: "rename" },
    ]},
    { name: "name", description: "Channel name", type: "string", required: false },
    { name: "type", description: "Channel type (text, announcement, voice, stage, forum)", type: "string", required: false },
    { name: "value", description: "New value (for topic/rename)", type: "string", required: false },
  ],
  permissions: Permissions.MANAGE_CHANNELS,
  serverOnly: true,
};

const channelHandler: CommandHandler = async (args, _ctx) => {
  switch (args.action) {
    case "create":
      if (!args.name) return { success: false, message: "Provide a channel name.", ephemeral: true };
      return { success: true, message: `✅ Channel **#${args.name}** created (${args.type ?? "text"}).`, ephemeral: false, data: { action: "channel_create", name: args.name, type: args.type ?? "text" } };
    case "delete":
      if (!args.name) return { success: false, message: "Provide a channel name.", ephemeral: true };
      return { success: true, message: `🗑️ Channel **#${args.name}** deleted.`, ephemeral: false, data: { action: "channel_delete", name: args.name } };
    case "topic":
      return { success: true, message: `✅ Channel topic updated${args.value ? `: ${args.value}` : ""}.`, ephemeral: false, data: { action: "channel_topic", topic: args.value } };
    case "rename":
      if (!args.name) return { success: false, message: "Provide a new channel name.", ephemeral: true };
      return { success: true, message: `✅ Channel renamed to **#${args.name}**.`, ephemeral: false, data: { action: "channel_rename", name: args.name } };
    default:
      return { success: false, message: `Unknown action: ${args.action}`, ephemeral: true };
  }
};

// ── /settings (server) ──────────────────────────────────────────────────────

const settingsCommand: SlashCommand = {
  name: "settings",
  description: "Open server settings panel",
  category: "server",
  params: [
    { name: "tab", description: "Settings tab to open", type: "string", required: false, choices: [
      { name: "Overview", value: "overview" },
      { name: "Appearance", value: "appearance" },
      { name: "Roles", value: "roles" },
      { name: "Members", value: "members" },
      { name: "Channels", value: "channels" },
      { name: "Audit Log", value: "audit-log" },
      { name: "Security", value: "security" },
    ]},
  ],
  permissions: Permissions.MANAGE_SERVER,
  serverOnly: true,
  ephemeral: true,
};

const settingsHandler: CommandHandler = async (args) => {
  const tab = args.tab ?? "overview";
  return {
    success: true,
    message: `⚙️ Opening server settings (${tab})...`,
    ephemeral: true,
    data: { action: "open_settings", tab },
  };
};

// ── /audit ──────────────────────────────────────────────────────────────────

const auditCommand: SlashCommand = {
  name: "audit",
  description: "View recent audit log entries",
  category: "server",
  params: [
    { name: "user", description: "Filter by user", type: "user", required: false },
    { name: "action", description: "Filter by action type", type: "string", required: false },
    { name: "limit", description: "Number of entries (default: 10)", type: "number", required: false },
  ],
  permissions: Permissions.VIEW_AUDIT_LOG,
  serverOnly: true,
  ephemeral: true,
};

const auditHandler: CommandHandler = async (args, ctx) => {
  return {
    success: true,
    message: `📋 **Audit Log** — Loading entries...`,
    ephemeral: true,
    data: { action: "audit_log", serverId: ctx.serverId, user: args.user, actionFilter: args.action, limit: args.limit },
  };
};

// ── /automod ────────────────────────────────────────────────────────────────

const automodCommand: SlashCommand = {
  name: "automod",
  description: "AutoMod management",
  category: "server",
  params: [
    { name: "action", description: "enable/disable/status", type: "string", required: true, choices: [
      { name: "Status", value: "status" },
      { name: "Enable", value: "enable" },
      { name: "Disable", value: "disable" },
    ]},
    { name: "rule", description: "Rule name", type: "string", required: false },
  ],
  permissions: Permissions.MANAGE_SERVER,
  serverOnly: true,
  ephemeral: true,
};

const automodHandler: CommandHandler = async (args) => {
  switch (args.action) {
    case "status":
      return { success: true, message: `🤖 **AutoMod Status** — Loading rules...`, ephemeral: true, data: { action: "automod_status" } };
    case "enable":
      return { success: true, message: `✅ AutoMod rule **${args.rule ?? "all"}** enabled.`, ephemeral: true, data: { action: "automod_enable", rule: args.rule } };
    case "disable":
      return { success: true, message: `⏸️ AutoMod rule **${args.rule ?? "all"}** disabled.`, ephemeral: true, data: { action: "automod_disable", rule: args.rule } };
    default:
      return { success: false, message: `Unknown action.`, ephemeral: true };
  }
};

// ── Registration ────────────────────────────────────────────────────────────

export function registerServerCommands(): void {
  registerCommand(serverCommand, serverHandler);
  registerCommand(channelCommand, channelHandler);
  registerCommand(settingsCommand, settingsHandler);
  registerCommand(auditCommand, auditHandler);
  registerCommand(automodCommand, automodHandler);
}
