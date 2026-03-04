import { invoke } from "@tauri-apps/api/core";
import type { GuardSettings } from "./state/settings";

export const getSettings = () => invoke<GuardSettings>("get_settings");

export const updateSettings = (settings: GuardSettings) =>
  invoke<void>("update_settings", { settings });

export const createBaseline = () => invoke<{ entries: number }>("create_baseline");

export const verifyBaseline = () => invoke<{ valid: boolean; detail: any }>("verify_baseline");
