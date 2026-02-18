/**
 * Strict Mode password management utilities
 */

// Simple hash function for password verification (client-side only)
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'darklock-strict-salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function setStrictModePassword(password: string): Promise<void> {
  const hash = await hashPassword(password);
  localStorage.setItem('darklock_strict_mode_password', hash);
  localStorage.setItem('darklock_strict_mode_enabled', 'true');
}

export async function verifyStrictModePassword(password: string): Promise<boolean> {
  const hash = await hashPassword(password);
  const stored = localStorage.getItem('darklock_strict_mode_password');
  return hash === stored;
}

export function isStrictModeEnabled(): boolean {
  return localStorage.getItem('darklock_strict_mode_enabled') === 'true';
}

export function clearStrictModePassword(): void {
  localStorage.removeItem('darklock_strict_mode_password');
  localStorage.removeItem('darklock_strict_mode_enabled');
  localStorage.removeItem('darklock_strict_mode_unlocked');
}

export function isAppUnlocked(): boolean {
  return localStorage.getItem('darklock_strict_mode_unlocked') === 'true';
}

export function setAppUnlocked(unlocked: boolean): void {
  if (unlocked) {
    localStorage.setItem('darklock_strict_mode_unlocked', 'true');
  } else {
    localStorage.removeItem('darklock_strict_mode_unlocked');
  }
}
