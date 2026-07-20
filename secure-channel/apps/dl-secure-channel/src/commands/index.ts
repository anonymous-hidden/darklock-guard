/**
 * Central command initializer — imports and registers all command categories.
 * Import this file once (e.g. in main.tsx or AppLayout) to activate all commands.
 */

import { registerModerationCommands } from "./moderation";
import { registerFunCommands } from "./fun";
import { registerUtilityCommands } from "./utility";
import { registerServerCommands } from "./server";

let initialized = false;

export function initializeAllCommands(): void {
  if (initialized) return;
  initialized = true;

  registerModerationCommands();
  registerFunCommands();
  registerUtilityCommands();
  registerServerCommands();

  console.log("[SC] All slash commands registered.");
}

export { registerModerationCommands, registerFunCommands, registerUtilityCommands, registerServerCommands };
