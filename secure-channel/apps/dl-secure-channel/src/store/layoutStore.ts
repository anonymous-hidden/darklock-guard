/**
 * layoutStore — UI layout state (selected server, channel panel, right panel toggle).
 */
import { create } from "zustand";

export type SidebarView = "home" | "server";
export type ServerSettingsTab = "overview" | "appearance" | "roles" | "members" | "channels" | "audit-log" | "security" | "invites";

interface LayoutState {
  /** Which top-level view: "home" = DMs/Friends, "server" = a group server */
  sidebarView: SidebarView;
  /** Currently selected server/group id (null = home) */
  activeServerId: string | null;
  /** Right member/info panel visibility */
  rightPanelOpen: boolean;
  /** Pin panel open */
  pinPanelOpen: boolean;
  /** Invite dialog open */
  inviteDialogOpen: boolean;
  /** Settings panel open */
  settingsOpen: boolean;
  /** Server settings modal */
  serverSettingsOpen: boolean;
  serverSettingsTab: ServerSettingsTab;

  setSidebarView: (view: SidebarView) => void;
  setActiveServer: (serverId: string | null) => void;
  toggleRightPanel: () => void;
  setRightPanelOpen: (open: boolean) => void;
  togglePinPanel: () => void;
  setPinPanelOpen: (open: boolean) => void;
  setInviteDialogOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  openServerSettings: (tab?: ServerSettingsTab) => void;
  closeServerSettings: () => void;
  setServerSettingsTab: (tab: ServerSettingsTab) => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  sidebarView: "home",
  activeServerId: null,
  rightPanelOpen: false,
  pinPanelOpen: false,
  inviteDialogOpen: false,
  settingsOpen: false,
  serverSettingsOpen: false,
  serverSettingsTab: "overview",

  setSidebarView: (view) => {
    console.log("[layoutStore] setSidebarView", view);
    set({ sidebarView: view });
  },
  setActiveServer: (serverId) => {
    console.log("[layoutStore] setActiveServer", serverId);
    set({
      activeServerId: serverId,
      sidebarView: serverId ? "server" : "home",
    });
  },
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  togglePinPanel: () => set((s) => ({ pinPanelOpen: !s.pinPanelOpen })),
  setPinPanelOpen: (open) => set({ pinPanelOpen: open }),
  setInviteDialogOpen: (open) => set({ inviteDialogOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  openServerSettings: (tab = "overview") => set({ serverSettingsOpen: true, serverSettingsTab: tab }),
  closeServerSettings: () => set({ serverSettingsOpen: false }),
  setServerSettingsTab: (tab) => set({ serverSettingsTab: tab }),
}));
