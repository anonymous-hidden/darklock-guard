import clsx from "clsx";
import {
  User,
  UserCircle,
  Shield,
  Smartphone,
  EyeOff,
  Lock,
  Bell,
  Palette,
  Wrench,
  LogOut,
  Link2,
} from "lucide-react";
import type { SettingsTab } from "@/store/settingsStore";

const NAV_SECTIONS = [
  {
    label: "User Settings",
    items: [
      { id: "account" as SettingsTab, label: "My Account", icon: User },
      { id: "profile" as SettingsTab, label: "Profile", icon: UserCircle },
      { id: "security" as SettingsTab, label: "Security", icon: Shield },
      { id: "devices" as SettingsTab, label: "Devices", icon: Smartphone },
      { id: "connections" as SettingsTab, label: "Connections", icon: Link2 },
    ],
  },
  {
    label: "App Settings",
    items: [
      { id: "privacy" as SettingsTab, label: "Privacy", icon: EyeOff },
      { id: "encryption" as SettingsTab, label: "Encryption", icon: Lock },
      { id: "notifications" as SettingsTab, label: "Notifications", icon: Bell },
      { id: "appearance" as SettingsTab, label: "Appearance", icon: Palette },
      { id: "advanced" as SettingsTab, label: "Advanced", icon: Wrench },
    ],
  },
];

interface Props {
  active: SettingsTab;
  username: string | null;
  avatarUrl?: string | null;
  onSelect: (tab: SettingsTab) => void;
  onLogout: () => void;
}

export default function SidebarNav({ active, username, avatarUrl, onSelect, onLogout }: Props) {
  return (
    <nav className="flex flex-col h-full w-[250px] shrink-0 bg-[#13161e] border-r border-white/[0.06] py-6 select-none">
      <div className="flex-1 overflow-y-auto px-4 space-y-6">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="px-2 mb-1.5 text-[10px] font-semibold tracking-widest uppercase text-white/30">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map(({ id, label, icon: Icon }) => {
                const isActive = active === id;
                return (
                  <button
                    key={id}
                    onClick={() => onSelect(id)}
                    className={clsx(
                      "group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                      isActive
                        ? "bg-white/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(99,102,241,0.15)]"
                        : "text-white/40 hover:text-white/70 hover:bg-white/[0.04]"
                    )}
                  >
                    <Icon
                      size={15}
                      className={clsx(
                        "shrink-0 transition-colors",
                        isActive ? "text-dl-accent" : "text-white/30 group-hover:text-white/50"
                      )}
                    />
                    <span className="flex-1 text-left">{label}</span>
                    {isActive && (
                      <div className="w-1 h-1 rounded-full bg-dl-accent opacity-80" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ── Bottom: user + logout ─────────────────────────────────────── */}
      <div className="mx-4 mt-4 pt-4 border-t border-white/[0.06]">
        <div className="flex items-center gap-2.5 px-2 py-2 mb-1">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt="avatar"
              className="w-8 h-8 rounded-full object-cover ring-1 ring-white/10 shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-dl-accent/20 flex items-center justify-center text-xs font-semibold text-dl-accent uppercase shrink-0">
              {(username ?? "U").charAt(0)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white/80 truncate">
              {username ?? "User"}
            </div>
            <div className="text-[10px] text-white/30">Online</div>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150"
        >
          <LogOut size={14} />
          Log Out
        </button>
      </div>
    </nav>
  );
}
