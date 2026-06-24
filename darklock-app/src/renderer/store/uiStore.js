import { create } from 'zustand';

export const useUIStore = create((set) => ({
  showSettings: false,
  showCreateServer: false,
  showInvite: false,
  showServerSettings: false,
  showTwoFactor: false,
  showMembers: true,
  showNovaCommandCenter: false,
  inviteServerId: null,
  settingsTab: 'account',
  fontSize: 16,
  messageDensity: 'cozy', // 'cozy' | 'compact'
  notificationsEnabled: true,
  notificationContent: 'sender', // 'preview' | 'sender' | 'none'
  soundsEnabled: true,

  toggleSettings: () => set(s => ({ showSettings: !s.showSettings })),
  toggleCreateServer: () => set(s => ({ showCreateServer: !s.showCreateServer })),
  toggleInviteModal: (serverId) => set(s => ({ showInvite: !s.showInvite, inviteServerId: serverId || s.inviteServerId })),
  toggleServerSettings: () => set(s => ({ showServerSettings: !s.showServerSettings })),
  toggleTwoFactor: () => set(s => ({ showTwoFactor: !s.showTwoFactor })),
  toggleMembers: () => set(s => ({ showMembers: !s.showMembers })),
  toggleNovaCommandCenter: () => set(s => ({ showNovaCommandCenter: !s.showNovaCommandCenter })),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  setFontSize: (size) => set({ fontSize: size }),
  setMessageDensity: (density) => set({ messageDensity: density }),
  setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled }),
  setSoundsEnabled: (enabled) => set({ soundsEnabled: enabled }),
  setNotificationContent: (content) => set({ notificationContent: content }),
  closeAll: () => set({
    showSettings: false,
    showCreateServer: false,
    showInvite: false,
    showServerSettings: false,
    showTwoFactor: false
  })
}));
