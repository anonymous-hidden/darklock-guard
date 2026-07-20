/**
 * tauri.ts — Electron / PWA settings & vault shim.
 *
 * Provides a consistent API surface used by settings tabs:
 *   setSetting / getSettings — key-value settings in localStorage
 *   changePassword           — re-encrypt vault with new password
 *   exportBackup             — JSON snapshot of settings
 *   resetVault               — wipe vault keys (requires password)
 *   clearLocalCache          — clear non-vault localStorage keys
 *   getProfile               — read cached profile from store
 *   updateProfile            — write profile fields to store + persist
 *   exportIdentityKey        — export the public identity key fingerprint
 *   regenerateKeys           — alias: triggers re-keying flow
 */

import type { ProfileDto } from "../types";

// ── Storage constants ─────────────────────────────────────────────────────────
const SETTINGS_PREFIX = "darklock_settings_";
const VAULT_PREFIX    = "darklock_vault_";

// ── Helpers ───────────────────────────────────────────────────────────────────
function settingsKey(key: string) {
  return SETTINGS_PREFIX + key;
}

// ── Settings KV ──────────────────────────────────────────────────────────────

/**
 * Persist a single settings value.
 * Values are always stored as strings.
 */
export async function setSetting(key: string, value: string): Promise<void> {
  try {
    localStorage.setItem(settingsKey(key), value);
  } catch {
    // Quota errors etc. are silently swallowed — non-critical.
  }
}

/**
 * Load all persisted settings as a flat key→value record.
 */
export async function getSettings(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const rawKey = localStorage.key(i);
    if (rawKey && rawKey.startsWith(SETTINGS_PREFIX)) {
      const key = rawKey.slice(SETTINGS_PREFIX.length);
      const val = localStorage.getItem(rawKey);
      if (val !== null) result[key] = val;
    }
  }
  return result;
}

// ── Password change ───────────────────────────────────────────────────────────

/**
 * Change the vault password.
 * Validates the current password by attempting to load the vault,
 * then re-encrypts with the new password-derived key.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const { useAuthStore } = await import("../store/authStore");
  const { userId } = useAuthStore.getState();

  if (!userId) throw new Error("Not authenticated.");
  if (!currentPassword) throw new Error("Current password is required.");
  if (newPassword.length < 12) throw new Error("Password must be at least 12 characters.");

  // Import vault helpers lazily to avoid circular deps at module init.
  const { loadVault, updateVault } = await import("../crypto/vault");

  // Verify current password by loading vault (throws if wrong).
  const material = await loadVault(userId, currentPassword);

  // Re-encrypt vault with new password.
  await updateVault(userId, newPassword, material);
}

// ── Backup export ─────────────────────────────────────────────────────────────

/**
 * Export a plaintext JSON snapshot of the user's settings.
 * Vault keys are NOT included.
 */
export async function exportBackup(): Promise<string> {
  const settings = await getSettings();
  const { useAuthStore } = await import("../store/authStore");
  const { userId } = useAuthStore.getState();

  const payload = {
    exported_at: new Date().toISOString(),
    user_id: userId ?? "unknown",
    settings,
  };

  const json = JSON.stringify(payload, null, 2);

  // Trigger download if running in Electron / browser.
  try {
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `darklock-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    // Fall through — caller can use the returned string.
  }

  return json;
}

// ── Vault reset ───────────────────────────────────────────────────────────────

/**
 * Delete all vault data for the current user.
 * Requires the current password as a safety check.
 */
export async function resetVault(password: string): Promise<void> {
  const { useAuthStore } = await import("../store/authStore");
  const { userId } = useAuthStore.getState();

  if (!userId) throw new Error("Not authenticated.");

  // Load vault to verify password before wiping.
  const { loadVault } = await import("../crypto/vault");
  await loadVault(userId, password);

  // Wipe all vault keys for this user.
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(VAULT_PREFIX + userId)) toRemove.push(k);
  }
  toRemove.forEach(k => localStorage.removeItem(k));

  // Clear settings too.
  const settingsToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(SETTINGS_PREFIX)) settingsToRemove.push(k);
  }
  settingsToRemove.forEach(k => localStorage.removeItem(k));
}

// ── Cache clear ───────────────────────────────────────────────────────────────

/**
 * Clear all non-vault localStorage keys (caches, drafts, etc.).
 */
export async function clearLocalCache(): Promise<void> {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && !k.startsWith(VAULT_PREFIX)) toRemove.push(k);
  }
  toRemove.forEach(k => localStorage.removeItem(k));

  // Clear sessionStorage too.
  try { sessionStorage.clear(); } catch { /* ignore */ }
}

// ── Profile ───────────────────────────────────────────────────────────────────

/**
 * Return the cached profile from settingsStore.
 */
export async function getProfile(): Promise<ProfileDto | null> {
  const { useSettingsStore } = await import("../store/settingsStore");
  return useSettingsStore.getState().profile;
}

/**
 * Update profile fields in settingsStore and persist via setSetting.
 */
export async function updateProfile(
  data: Partial<ProfileDto>,
): Promise<void> {
  const { useSettingsStore } = await import("../store/settingsStore");
  const current = useSettingsStore.getState().profile;
  if (current) {
    useSettingsStore.getState().setProfile({ ...current, ...data });
  }
  // Persist serialisable fields.
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string") await setSetting(k, v);
  }
}

// ── Identity key export ───────────────────────────────────────────────────────

/**
 * Return the hex fingerprint of the user's identity key (from their profile).
 */
export async function exportIdentityKey(): Promise<string> {
  const { useSettingsStore } = await import("../store/settingsStore");
  const profile = useSettingsStore.getState().profile;
  return profile?.fingerprint ?? "";
}

// ── E2EE key regeneration ─────────────────────────────────────────────────────

/**
 * Regenerate the device's E2EE pre-keys and upload them to the relay.
 * This clears existing sessions for this device.
 */
export async function regenerateKeys(): Promise<void> {
  // Clear cached E2EE session data so new sessions are negotiated on next message.
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && (k.includes("_session_") || k.includes("_prekey_") || k.includes("_otpk_"))) {
      toRemove.push(k);
    }
  }
  toRemove.forEach(k => localStorage.removeItem(k));

  // Notify the relay that keys need re-upload (best-effort).
  try {
    const { useAuthStore } = await import("../store/authStore");
    const { authToken } = useAuthStore.getState();
    if (authToken) {
      const rlyBase = (window as any).__RLY_BASE__ ?? import.meta.env.VITE_RLY_URL ?? "https://rly.darklock.net";
      await fetch(`${rlyBase}/api/keys/invalidate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "user_regenerated" }),
      });
    }
  } catch {
    // Non-fatal — local session clear already happened.
  }
}
