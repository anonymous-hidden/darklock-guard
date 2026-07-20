import type { GroupInfo, GroupModerationSettings } from '../types';

export const DEFAULT_GROUP_MODERATION: GroupModerationSettings = {
  enabled: false,
  blockedTerms: [],
  mode: 'block',
  notifyMembers: true,
  exemptRoleIds: [],
};

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

export function parseBlockedTermsInput(input: string): string[] {
  return uniqueStrings(
    String(input ?? '')
      .split(/[\n,]+/g)
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function normalizeModerationSettings(value: unknown): GroupModerationSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_GROUP_MODERATION };
  }

  const raw = value as Partial<GroupModerationSettings>;

  const mode = raw.mode === 'warn' || raw.mode === 'block' || raw.mode === 'mask'
    ? raw.mode
    : DEFAULT_GROUP_MODERATION.mode;

  const blockedTerms = Array.isArray(raw.blockedTerms)
    ? uniqueStrings(raw.blockedTerms.map((term) => String(term ?? '')))
    : [];

  const exemptRoleIds = Array.isArray(raw.exemptRoleIds)
    ? uniqueStrings(raw.exemptRoleIds.map((roleId) => String(roleId ?? '')))
    : [];

  return {
    enabled: !!raw.enabled,
    blockedTerms,
    mode,
    notifyMembers: typeof raw.notifyMembers === 'boolean'
      ? raw.notifyMembers
      : DEFAULT_GROUP_MODERATION.notifyMembers,
    exemptRoleIds,
    ...(typeof raw.updatedAt === 'number' ? { updatedAt: raw.updatedAt } : {}),
    ...(typeof raw.updatedBy === 'string' && raw.updatedBy.trim()
      ? { updatedBy: raw.updatedBy.trim() }
      : {}),
  };
}

export function getGroupModeration(group: GroupInfo | null | undefined): GroupModerationSettings {
  return normalizeModerationSettings(group?.moderation);
}

export function hasModerationExemption(roleIds: string[] | undefined, settings: GroupModerationSettings): boolean {
  if (!Array.isArray(roleIds) || roleIds.length === 0) return false;
  const exempt = new Set(settings.exemptRoleIds);
  return roleIds.some((roleId) => exempt.has(String(roleId)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectMatches(term: string): RegExp {
  const escaped = escapeRegExp(term);
  const useWordBoundary = /^[a-z0-9_-]+$/i.test(term);
  return new RegExp(useWordBoundary ? `\\b${escaped}\\b` : escaped, 'gi');
}

export function evaluateModeration(
  text: string,
  settings: GroupModerationSettings,
): { blocked: boolean; sanitizedText: string; matchedTerms: string[] } {
  const source = String(text ?? '');
  if (!settings.enabled || settings.blockedTerms.length === 0 || !source.trim()) {
    return { blocked: false, sanitizedText: source, matchedTerms: [] };
  }

  const matched = new Set<string>();
  let sanitized = source;

  for (const term of settings.blockedTerms) {
    const regex = collectMatches(term);
    const hasMatch = regex.test(source);
    if (!hasMatch) continue;

    matched.add(term);

    if (settings.mode === 'block') {
      return {
        blocked: true,
        sanitizedText: source,
        matchedTerms: [...matched],
      };
    }

    if (settings.mode === 'mask') {
      const replaceRegex = collectMatches(term);
      sanitized = sanitized.replace(replaceRegex, (value) => '*'.repeat(value.length));
    }
  }

  return {
    blocked: false,
    sanitizedText: sanitized,
    matchedTerms: [...matched],
  };
}
