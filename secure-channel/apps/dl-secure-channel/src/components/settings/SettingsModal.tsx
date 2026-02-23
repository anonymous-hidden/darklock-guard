/**
 * SettingsModal — Discord-style full modal with sidebar nav + content panel.
 *
 * Open it from anywhere via: useSettingsStore.getState().openSettings("account")
 */
import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

import { useSettingsStore, type SettingsTab } from "@/store/settingsStore";
import { useAuthStore } from "@/store/authStore";
import { useServerStore } from "@/store/serverStore";
import { useLayoutStore } from "@/store/layoutStore";
import SidebarNav from "./SidebarNav";
import MyAccountTab from "./tabs/MyAccountTab";
import SecurityTab from "./tabs/SecurityTab";
import DevicesTab from "./tabs/DevicesTab";
import PrivacyTab from "./tabs/PrivacyTab";
import EncryptionTab from "./tabs/EncryptionTab";
import NotificationsTab from "./tabs/NotificationsTab";
import AppearanceTab from "./tabs/AppearanceTab";
import AdvancedTab from "./tabs/AdvancedTab";
import ProfileTab from "./tabs/ProfileTab";
import ConnectionsTab from "./tabs/ConnectionsTab";

const TAB_TITLES: Record<SettingsTab, string> = {
  account: "My Account",
  profile: "Profile",
  security: "Security",
  devices: "Devices",
  privacy: "Privacy",
  encryption: "Encryption",
  notifications: "Notifications",
  appearance: "Appearance",
  advanced: "Advanced",
  connections: "Connections",
};

function TabContent({ tab }: { tab: SettingsTab }) {
  switch (tab) {
    case "account":      return <MyAccountTab />;
    case "profile":      return <ProfileTab />;
    case "security":     return <SecurityTab />;
    case "devices":      return <DevicesTab />;
    case "privacy":      return <PrivacyTab />;
    case "encryption":   return <EncryptionTab />;
    case "notifications": return <NotificationsTab />;
    case "appearance":   return <AppearanceTab />;
    case "advanced":     return <AdvancedTab />;
    case "connections":  return <ConnectionsTab />;
  }
}

export default function SettingsModal() {
  const { username, clearAuth } = useAuthStore();
  const { closeSettings, loadSettings, avatarDataUrl, isOpen, activeTab, setTab } = useSettingsStore();
  const resetUserData = useSettingsStore((s) => s.resetUserData);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Load persisted settings from DB each time the modal opens
  useEffect(() => {
    if (isOpen) loadSettings();
  }, [isOpen]);

  // Escape key to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closeSettings(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closeSettings]);

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  const handleLogout = async () => {
    try {
      const { logout } = await import("@/lib/tauri");
      await logout();
    } catch {}
    // Clear all server/channel/role state so stale IDs don't fire requests on next login
    useServerStore.getState().reset();
    useLayoutStore.getState().setActiveServer(null);
    resetUserData();  // Clear user-specific data so next login starts fresh
    clearAuth();
    closeSettings();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) closeSettings();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={overlayRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={handleOverlayClick}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-md"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex overflow-hidden rounded-2xl shadow-2xl shadow-black/60 border border-white/[0.06]"
            style={{
              width: "min(1160px, 96vw)",
              height: "min(800px, 92vh)",
              background: "#0f1117",
            }}
          >
            {/* Sidebar */}
            <SidebarNav
              active={activeTab}
              username={username}
              avatarUrl={avatarDataUrl}
              onSelect={setTab}
              onLogout={handleLogout}
            />

            {/* Content panel */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Content header */}
              <div className="flex items-center justify-between px-10 pt-9 pb-5 shrink-0">
                <div>
                  <h1 className="text-base font-semibold text-white/90">{TAB_TITLES[activeTab]}</h1>
                  <div className="h-px w-full mt-3 bg-white/[0.06]" />
                </div>
                <button
                  onClick={closeSettings}
                  className="absolute top-5 right-5 w-8 h-8 rounded-full flex items-center justify-center text-white/25 hover:text-white/70 hover:bg-white/[0.06] transition-all"
                  aria-label="Close settings"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Scrollable tab content */}
              <div className="flex-1 overflow-y-auto px-10 pb-10 overscroll-contain">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.14, ease: "easeOut" }}
                  >
                    <TabContent tab={activeTab} />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
