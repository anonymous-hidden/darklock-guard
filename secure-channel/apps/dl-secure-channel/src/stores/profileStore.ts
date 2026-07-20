/* ──────────────────────────────────────────────────────────
 *  Profile Store — user personalization data
 * ────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible';
export type CustomStatusClearAfter = 'never' | '30m' | '1h' | '4h' | 'end_of_today';
export type BannerFit = 'cover' | 'contain';

export const PRESENCE_COLORS: Record<PresenceStatus, string> = {
  online: '#22c55e',
  idle: '#eab308',
  dnd: '#ef4444',
  invisible: '#6b7280',
};

export interface ProfileLink {
  id: string;
  label: string;
  url: string;
}

interface ProfileState {
  username: string;
  displayName: string;
  avatar: string | null;
  banner: string | null;
  bannerFit: BannerFit;
  bio: string;
  pronouns: string;
  links: ProfileLink[];
  usernameColor: string;
  accentColor: string;
  accentColor2: string;    // second gradient color (empty = single color)
  gradientAngle: number;   // gradient angle in degrees
  statusText: string;
  statusEmoji: string;
  presence: PresenceStatus;
  customStatus: string;
  customStatusExpiresAt: string | null;
  customStatusClearAfter: CustomStatusClearAfter;
  selectedTags: string[];  // up to 5 tag IDs to display on profile
  nameplate: string;        // nameplate ID (empty = none)
  displayNameFont: string;  // font style ID for display name
  /** Ordered section IDs for profile preview layout */
  sectionOrder: string[];

  setUsername: (username: string) => void;
  setDisplayName: (name: string) => void;
  setAvatar: (data: string | null) => void;
  setBanner: (data: string | null) => void;
  setBannerFit: (fit: BannerFit) => void;
  setBio: (bio: string) => void;
  setPronouns: (pronouns: string) => void;
  setLinks: (links: ProfileLink[]) => void;
  addLink: (label: string, url: string) => void;
  removeLink: (id: string) => void;
  setUsernameColor: (color: string) => void;
  setAccentColor: (color: string) => void;
  setAccentColor2: (color: string) => void;
  setGradientAngle: (angle: number) => void;
  setStatusText: (text: string) => void;
  setStatusEmoji: (emoji: string) => void;
  setPresence: (status: PresenceStatus) => void;
  setCustomStatus: (status: string) => void;
  setCustomStatusExpiry: (expiresAt: string | null, clearAfter: CustomStatusClearAfter) => void;
  setSelectedTags: (tags: string[]) => void;
  toggleSelectedTag: (tagId: string) => void;
  setNameplate: (id: string) => void;
  setDisplayNameFont: (font: string) => void;
  setSectionOrder: (order: string[]) => void;
}

const COLOR_PRESETS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6',
  '#06b6d4', '#f43f5e', '#d946ef', '#84cc16', '#ffffff',
];

export { COLOR_PRESETS };

export const useProfileStore = create<ProfileState>()(persist((set) => ({
  username: '',
  displayName: '',
  avatar: null,
  banner: null,
  bannerFit: 'cover',
  bio: '',
  pronouns: '',
  links: [],
  usernameColor: '#6366f1',
  accentColor: '#6366f1',
  accentColor2: '',
  gradientAngle: 135,
  statusText: '',
  statusEmoji: '',
  presence: 'online',
  customStatus: '',
  customStatusExpiresAt: null,
  customStatusClearAfter: 'never',
  selectedTags: [],
  nameplate: '',
  displayNameFont: 'default',
  sectionOrder: ['tags', 'status', 'bio', 'links'],

  setUsername: (username) => set({ username }),
  setDisplayName: (name) => set({ displayName: name }),
  setAvatar: (data) => set({ avatar: data }),
  setBanner: (data) => set({ banner: data }),
  setBannerFit: (bannerFit) => set({ bannerFit }),
  setBio: (bio) => set({ bio }),
  setPronouns: (pronouns) => set({ pronouns }),
  setLinks: (links) => set({ links }),
  addLink: (label, url) =>
    set((s) => ({
      links: [...s.links, { id: crypto.randomUUID(), label, url }],
    })),
  removeLink: (id) =>
    set((s) => ({
      links: s.links.filter((l) => l.id !== id),
    })),
  setUsernameColor: (color) => set({ usernameColor: color }),
  setAccentColor: (color) => set({ accentColor: color }),
  setAccentColor2: (color) => set({ accentColor2: color }),
  setGradientAngle: (angle) => set({ gradientAngle: angle }),
  setStatusText: (text) => set({ statusText: text }),
  setStatusEmoji: (emoji) => set({ statusEmoji: emoji }),
  setPresence: (presence) => set({ presence }),
  setCustomStatus: (customStatus) => set({ customStatus }),
  setCustomStatusExpiry: (customStatusExpiresAt, customStatusClearAfter) => set({ customStatusExpiresAt, customStatusClearAfter }),
  setSelectedTags: (tags) => set({ selectedTags: tags.slice(0, 5) }),
  toggleSelectedTag: (tagId) => set((s) => {
    if (s.selectedTags.includes(tagId)) {
      return { selectedTags: s.selectedTags.filter(id => id !== tagId) };
    }
    if (s.selectedTags.length >= 5) return s;
    return { selectedTags: [...s.selectedTags, tagId] };
  }),
  setNameplate: (id) => set({ nameplate: id }),
  setDisplayNameFont: (font) => set({ displayNameFont: font }),
  setSectionOrder: (order) => set({ sectionOrder: order }),
}), { name: 'dl-profile' }));

// Preserve store state across Vite HMR
if (import.meta.hot) {
  import.meta.hot.accept();
  const prev = (import.meta.hot.data as any)?.profileState;
  if (prev) useProfileStore.setState(prev);
  import.meta.hot.dispose((data: any) => {
    data.profileState = useProfileStore.getState();
  });
}
