import { create } from 'zustand';

export const useServerStore = create((set, get) => ({
  servers: [],
  activeServerId: null,
  channels: {},      // serverId → channel[]
  activeChannelId: null,
  members: {},       // serverId → member[]

  setServers: (servers) => set({ servers }),

  addServer: (server) => set(state => ({
    servers: [...state.servers, server]
  })),

  setActiveServer: (serverId) => set({ activeServerId: serverId }),

  setChannels: (serverId, channels) => set(state => ({
    channels: { ...state.channels, [serverId]: channels }
  })),

  setActiveChannel: (channelId) => set({ activeChannelId: channelId }),

  setMembers: (serverId, members) => set(state => ({
    members: { ...state.members, [serverId]: members }
  })),

  getActiveChannels: () => {
    const state = get();
    return state.channels[state.activeServerId] || [];
  },

  getActiveMembers: () => {
    const state = get();
    return state.members[state.activeServerId] || [];
  },

  clear: () => set({
    servers: [],
    activeServerId: null,
    channels: {},
    activeChannelId: null,
    members: {}
  })
}));
