import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGroupChannelConversationId } from '../utils/groupChannelKeys';

type LocalStorageMock = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
  key: (index: number) => string | null;
  readonly length: number;
};

function createLocalStorageMock(): LocalStorageMock {
  const backing = new Map<string, string>();
  return {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => {
      backing.set(key, value);
    },
    removeItem: (key) => {
      backing.delete(key);
    },
    clear: () => {
      backing.clear();
    },
    key: (index) => Array.from(backing.keys())[index] ?? null,
    get length() {
      return backing.size;
    },
  };
}

describe('convThemeStore group mode', () => {
  let useConvThemeStore: typeof import('./convThemeStore').useConvThemeStore;

  beforeEach(async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createLocalStorageMock(),
    });

    vi.resetModules();
    ({ useConvThemeStore } = await import('./convThemeStore'));
  });

  it('applies group theme by default and supports switching to personal overrides', () => {
    const groupId = 'group-theme-1';
    const channelConvId = makeGroupChannelConversationId(groupId, 'channel-general');

    useConvThemeStore.getState().setTheme(groupId, {
      bgType: 'solid',
      bgValue: '#111318',
    });

    useConvThemeStore.getState().setTheme(channelConvId, {
      bgType: 'gradient',
      bgValue: 'linear-gradient(180deg,#111,#222)',
    });

    let effective = useConvThemeStore.getState().getTheme(channelConvId);
    expect(effective.bgType).toBe('solid');
    expect(effective.bgValue).toBe('#111318');

    useConvThemeStore.getState().setGroupThemeMode(channelConvId, 'personal');

    effective = useConvThemeStore.getState().getTheme(channelConvId);
    expect(effective.bgType).toBe('gradient');
    expect(effective.bgValue).toBe('linear-gradient(180deg,#111,#222)');

    useConvThemeStore.getState().setGroupThemeMode(channelConvId, 'group');

    effective = useConvThemeStore.getState().getTheme(channelConvId);
    expect(effective.bgType).toBe('solid');
    expect(effective.bgValue).toBe('#111318');
  });
});
