/* ──────────────────────────────────────────────────────────
 *  Tag Store — collectible badge / tag system
 * ────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ── Tag definition ────────────────────────────────────── */

export interface TagDef {
  id: string;
  label: string;
  color: string;        // pill background
  textColor?: string;   // pill text (defaults to white)
  category: TagCategory;
  adminOnly?: boolean;  // can only be given via admin panel
}

export type TagCategory =
  | 'staff'
  | 'holiday'
  | 'anniversary'
  | 'achievement'
  | 'special'
  | 'seasonal';

/* ── All 53 tags ───────────────────────────────────────── */

export const ALL_TAGS: TagDef[] = [
  // ── Staff (admin-only) ──────────────────────
  { id: 'owner',   label: 'Owner',    color: '#f59e0b', category: 'staff', adminOnly: true },
  { id: 'coowner', label: 'Co-Owner', color: '#d97706', category: 'staff', adminOnly: true },
  { id: 'dev',     label: 'Developer',color: '#6366f1', category: 'staff', adminOnly: true },

  // ── Anniversary (member years) ──────────────
  { id: 'member-2024', label: 'Est. 2024', color: '#3b82f6', category: 'anniversary' },
  { id: 'member-2025', label: 'Est. 2025', color: '#6366f1', category: 'anniversary' },
  { id: 'member-2026', label: 'Est. 2026', color: '#8b5cf6', category: 'anniversary' },
  { id: 'member-2027', label: 'Est. 2027', color: '#a855f7', category: 'anniversary' },
  { id: 'member-1yr',  label: '1 Year',    color: '#22c55e', category: 'anniversary' },
  { id: 'member-2yr',  label: '2 Years',   color: '#16a34a', category: 'anniversary' },
  { id: 'member-3yr',  label: '3 Years',   color: '#15803d', category: 'anniversary' },
  { id: 'member-5yr',  label: '5 Years',   color: '#f59e0b', category: 'anniversary' },

  // ── Holiday tags ────────────────────────────
  { id: 'nye-2024',        label: 'NYE 2024',          color: '#6366f1', category: 'holiday' },
  { id: 'nye-2025',        label: 'NYE 2025',          color: '#818cf8', category: 'holiday' },
  { id: 'nye-2026',        label: 'NYE 2026',          color: '#a78bfa', category: 'holiday' },
  { id: 'valentines-2025', label: "Valentine's 2025",  color: '#e11d48', category: 'holiday' },
  { id: 'valentines-2026', label: "Valentine's 2026",  color: '#f43f5e', category: 'holiday' },
  { id: 'stpatricks-2025', label: "St. Patrick's 2025",color: '#16a34a', category: 'holiday' },
  { id: 'stpatricks-2026', label: "St. Patrick's 2026",color: '#22c55e', category: 'holiday' },
  { id: 'easter-2025',     label: 'Easter 2025',       color: '#a855f7', category: 'holiday' },
  { id: 'easter-2026',     label: 'Easter 2026',       color: '#c084fc', category: 'holiday' },
  { id: 'july4-2025',      label: '4th of July 2025',  color: '#2563eb', category: 'holiday' },
  { id: 'july4-2026',      label: '4th of July 2026',  color: '#3b82f6', category: 'holiday' },
  { id: 'halloween-2024',  label: 'Halloween 2024',    color: '#ea580c', category: 'holiday' },
  { id: 'halloween-2025',  label: 'Halloween 2025',    color: '#f97316', category: 'holiday' },
  { id: 'halloween-2026',  label: 'Halloween 2026',    color: '#fb923c', category: 'holiday' },
  { id: 'thanksgiving-2024', label: 'Thanksgiving 2024', color: '#92400e', category: 'holiday' },
  { id: 'thanksgiving-2025', label: 'Thanksgiving 2025', color: '#b45309', category: 'holiday' },
  { id: 'thanksgiving-2026', label: 'Thanksgiving 2026', color: '#d97706', category: 'holiday' },
  { id: 'xmas-2024',       label: 'Christmas 2024',    color: '#dc2626', category: 'holiday' },
  { id: 'xmas-2025',       label: 'Christmas 2025',    color: '#ef4444', category: 'holiday' },
  { id: 'xmas-2026',       label: 'Christmas 2026',    color: '#f87171', category: 'holiday' },

  // ── Seasonal ────────────────────────────────
  { id: 'spring-2025', label: 'Spring 2025', color: '#ec4899', category: 'seasonal' },
  { id: 'spring-2026', label: 'Spring 2026', color: '#f472b6', category: 'seasonal' },
  { id: 'summer-2025', label: 'Summer 2025', color: '#eab308', category: 'seasonal' },
  { id: 'summer-2026', label: 'Summer 2026', color: '#facc15', category: 'seasonal' },
  { id: 'fall-2025',   label: 'Fall 2025',   color: '#d97706', category: 'seasonal' },
  { id: 'fall-2026',   label: 'Fall 2026',   color: '#f59e0b', category: 'seasonal' },
  { id: 'winter-2025', label: 'Winter 2025', color: '#0ea5e9', category: 'seasonal' },
  { id: 'winter-2026', label: 'Winter 2026', color: '#38bdf8', category: 'seasonal' },

  // ── Achievement ─────────────────────────────
  { id: 'early-adopter',  label: 'Early Adopter', color: '#6366f1', category: 'achievement' },
  { id: 'bug-hunter',     label: 'Bug Hunter',    color: '#22c55e', category: 'achievement' },
  { id: 'crypto-king',    label: 'Crypto King',   color: '#8b5cf6', category: 'achievement' },
  { id: 'night-owl',      label: 'Night Owl',     color: '#475569', category: 'achievement' },
  { id: 'chatterbox',     label: 'Chatterbox',    color: '#0891b2', category: 'achievement' },
  { id: 'vault-keeper',   label: 'Vault Keeper',  color: '#b45309', category: 'achievement' },
  { id: 'og-member',      label: 'OG Member',     color: '#f59e0b', category: 'achievement' },
  { id: 'trusted',        label: 'Trusted',       color: '#16a34a', category: 'achievement' },
  { id: 'quest-complete', label: 'Quest Complete', color: '#10b981', category: 'achievement' },
  { id: 'msg-1k',         label: '1K Messages',   color: '#06b6d4', category: 'achievement' },
  { id: 'msg-10k',        label: '10K Messages',  color: '#0284c7', category: 'achievement' },
  { id: 'msg-100k',       label: '100K Messages', color: '#1d4ed8', category: 'achievement' },
  { id: 'file-sharer',    label: 'File Sharer',   color: '#7c3aed', category: 'achievement' },
  { id: 'streaker',       label: 'Streaker',       color: '#e11d48', category: 'achievement' },
  { id: 'speed-demon',    label: 'Speed Demon',   color: '#dc2626', category: 'achievement' },

  // ── Special ─────────────────────────────────
  { id: 'beta-tester',    label: 'Beta Tester',  color: '#7c3aed', category: 'special' },
  { id: 'supporter',      label: 'Supporter',    color: '#2563eb', category: 'special' },
  { id: 'contributor',    label: 'Contributor',  color: '#059669', category: 'special' },
  { id: 'vip',            label: 'VIP',          color: '#d97706', category: 'special' },
  { id: 'verified',       label: 'Verified',     color: '#3b82f6', category: 'special' },
  { id: 'premium',        label: 'Premium',      color: '#f59e0b', category: 'special' },
  { id: 'partner',        label: 'Partner',      color: '#6366f1', category: 'special' },
  { id: 'moderator',      label: 'Moderator',    color: '#059669', category: 'special', adminOnly: true },
];

export const TAG_MAP: Record<string, TagDef> = Object.fromEntries(ALL_TAGS.map(t => [t.id, t]));

/* ── Category display names ──────────────────────────── */

export const CATEGORY_LABELS: Record<TagCategory, string> = {
  staff: 'Staff',
  holiday: 'Holidays',
  anniversary: 'Membership',
  achievement: 'Achievements',
  special: 'Special',
  seasonal: 'Seasonal',
};

/* ── Store ─────────────────────────────────────────────── */

interface TagState {
  /** userId → Set of tag IDs */
  userTags: Record<string, string[]>;

  /** Replace the known granted tags for a user */
  setUserTags: (userId: string, tagIds: string[]) => void;

  /** Give tag to a user */
  giveTag: (userId: string, tagId: string) => void;

  /** Remove tag from a user */
  removeTag: (userId: string, tagId: string) => void;

  /** Get tags for a user */
  getTags: (userId: string) => TagDef[];

  /** Remove a user entirely */
  removeUser: (userId: string) => void;
}

export const useTagStore = create<TagState>()(persist((set, get) => ({
  userTags: {},

  setUserTags: (userId, tagIds) =>
    set(state => ({
      userTags: {
        ...state.userTags,
        [userId]: [...new Set(tagIds)],
      },
    })),

  giveTag: (userId, tagId) =>
    set(state => {
      const current = state.userTags[userId] ?? [];
      if (current.includes(tagId)) return state;
      return {
        userTags: { ...state.userTags, [userId]: [...current, tagId] },
      };
    }),

  removeTag: (userId, tagId) =>
    set(state => {
      const current = state.userTags[userId] ?? [];
      return {
        userTags: { ...state.userTags, [userId]: current.filter(t => t !== tagId) },
      };
    }),

  getTags: (userId) => {
    const ids = get().userTags[userId] ?? [];
    return ids.map(id => TAG_MAP[id]).filter(Boolean);
  },

  removeUser: (userId) =>
    set(state => {
      const { [userId]: _, ...rest } = state.userTags;
      return { userTags: rest };
    }),
}), { name: 'dl-tags' }));
