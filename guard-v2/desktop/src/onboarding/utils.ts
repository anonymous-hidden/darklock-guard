/**
 * Darklock Guard — Onboarding Utilities
 *
 * Pure functions used across the onboarding flow.
 * No side effects, no React dependencies.
 */

/**
 * Calculate password strength on a 0-4 scale.
 * Scoring: length (12+, 16+, 20+), mixed case, digits, symbols.
 */
export function getPasswordStrength(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (pw.length >= 20) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(4, score);
}

/**
 * Validate password meets minimum requirements.
 * Returns null if valid, or an error string.
 */
export function validatePassword(pw: string): string | null {
  if (pw.length < 12) return 'Password must be at least 12 characters';
  if (!/[A-Z]/.test(pw)) return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(pw)) return 'Password must contain a lowercase letter';
  if (!/\d/.test(pw)) return 'Password must contain a number';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must contain a special character';
  return null;
}

/**
 * Validate email with basic regex.
 */
export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validate username: 3-32 chars, alphanumeric + underscores/hyphens.
 */
export function validateUsername(username: string): string | null {
  if (username.length < 3) return 'Username must be at least 3 characters';
  if (username.length > 32) return 'Username must be at most 32 characters';
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) return 'Username can only contain letters, numbers, hyphens, and underscores';
  return null;
}

/**
 * Generate a step indicator progress value (0 to 1).
 */
export function getStepProgress(
  currentStep: string,
  steps: string[],
): number {
  const idx = steps.indexOf(currentStep);
  if (idx === -1) return 0;
  return idx / (steps.length - 1);
}
