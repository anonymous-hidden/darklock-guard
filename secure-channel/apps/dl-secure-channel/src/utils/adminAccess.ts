/* ──────────────────────────────────────────────────────────
 *  Admin access — single source of truth for staff gating.
 *  Authority comes from the IDS-issued system role; the
 *  hardcoded dev IDs only work in Vite dev builds.
 * ────────────────────────────────────────────────────────── */

const STAFF_ROLES = new Set(['owner', 'admin']);

const DEV_ADMIN_IDS = new Set(['dev-user-0000', 'ridgeline-user-one']);

export function canAccessAdminPanel(userId: string | null, systemRole: string | null): boolean {
  if (systemRole && STAFF_ROLES.has(systemRole)) return true;
  if (import.meta.env.DEV && userId && DEV_ADMIN_IDS.has(userId)) return true;
  return false;
}
