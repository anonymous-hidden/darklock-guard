import React from "react";
import { Crown, Shield, ShieldCheck, User, Cpu } from "lucide-react";

// ── Role configuration ────────────────────────────────────────────────────────

type RoleConfig = {
  label: string;
  icon: React.ElementType;
  color: string;
  bg: string;
};

const ROLE_CONFIG: Record<string, RoleConfig> = {
  owner: {
    label: "Owner",
    icon: Crown,
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.15)",
  },
  admin: {
    label: "Admin",
    icon: Shield,
    color: "#a855f7",
    bg: "rgba(168,85,247,0.15)",
  },
  moderator: {
    label: "Mod",
    icon: ShieldCheck,
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.15)",
  },
  bot: {
    label: "Bot",
    icon: Cpu,
    color: "#06b6d4",
    bg: "rgba(6,182,212,0.15)",
  },
  user: {
    label: "User",
    icon: User,
    color: "#6b7280",
    bg: "rgba(107,114,128,0.15)",
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

interface RoleTagProps {
  role?: string | null;
  /** "pill" (default) — full pill with icon + label. "badge" — compact icon-only badge. */
  variant?: "pill" | "badge";
  className?: string;
}

export const RoleTag: React.FC<RoleTagProps> = ({
  role,
  variant = "pill",
  className,
}) => {
  if (!role || role === "user") return null;

  const cfg = ROLE_CONFIG[role] ?? {
    label: role,
    icon: Shield,
    color: "#6b7280",
    bg: "rgba(107,114,128,0.15)",
  };

  const Icon = cfg.icon;

  if (variant === "badge") {
    return (
      <span
        className={`role-badge role-badge--${role}${className ? ` ${className}` : ""}`}
        title={cfg.label}
        style={{ color: cfg.color }}
        aria-label={cfg.label}
      >
        <Icon size={11} strokeWidth={2.2} />
      </span>
    );
  }

  return (
    <span
      className={`role-tag role-tag--${role}${className ? ` ${className}` : ""}`}
      style={{ color: cfg.color, background: cfg.bg }}
      aria-label={`Role: ${cfg.label}`}
    >
      <Icon size={11} strokeWidth={2.2} />
      {cfg.label}
    </span>
  );
};

export default RoleTag;
