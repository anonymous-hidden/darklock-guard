import { create } from "zustand";
import type { ContactProfileDto, UserTagDto } from "@/types";
import { getContactProfile, getUserTags } from "@/lib/tauri";

export interface CachedProfile extends ContactProfileDto {
  selected_tags?: UserTagDto[];
  fetched_at: number;
}

interface ProfileState {
  profiles: Record<string, CachedProfile>;
  fetchProfile: (userId: string, force?: boolean) => Promise<CachedProfile | null>;
  invalidateProfile: (userId: string) => void;
  clear: () => void;
}

const TTL_MS = 60_000;

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: {},

  fetchProfile: async (userId, force = false) => {
    if (!userId) return null;
    const cached = get().profiles[userId];
    if (cached && !force && Date.now() - cached.fetched_at < TTL_MS) {
      return cached;
    }
    try {
      const [profile, tags] = await Promise.all([
        getContactProfile(userId),
        getUserTags(userId).catch(() => []),
      ]);
      const next: CachedProfile = {
        ...profile,
        selected_tags: tags,
        fetched_at: Date.now(),
      };
      set((s) => ({ profiles: { ...s.profiles, [userId]: next } }));
      return next;
    } catch {
      return cached ?? null;
    }
  },

  invalidateProfile: (userId) => set((s) => {
    const next = { ...s.profiles };
    delete next[userId];
    return { profiles: next };
  }),

  clear: () => set({ profiles: {} }),
}));
