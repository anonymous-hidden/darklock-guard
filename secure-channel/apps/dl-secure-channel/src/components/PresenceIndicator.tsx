/**
 * PresenceIndicator — Small colored dot showing user's online status.
 * Placed on avatars throughout the app.
 */
import clsx from "clsx";
import type { PresenceStatus } from "@/types";

const STATUS_COLORS: Record<PresenceStatus, string> = {
  online: "bg-green-500",
  idle: "bg-amber-500",
  dnd: "bg-red-500",
  invisible: "bg-gray-500",
  offline: "bg-gray-500",
};

const STATUS_LABELS: Record<PresenceStatus, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  invisible: "Invisible",
  offline: "Offline",
};

interface PresenceIndicatorProps {
  status: PresenceStatus;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export default function PresenceIndicator({
  status,
  size = "md",
  className,
}: PresenceIndicatorProps) {
  const sizeClass =
    size === "sm" ? "w-2 h-2" :
    size === "lg" ? "w-3.5 h-3.5" :
    "w-2.5 h-2.5";

  const outerSize =
    size === "sm" ? "w-3 h-3" :
    size === "lg" ? "w-5 h-5" :
    "w-3.5 h-3.5";

  return (
    <div
      className={clsx(
        "rounded-full bg-dl-bg flex items-center justify-center",
        outerSize,
        className
      )}
      title={STATUS_LABELS[status]}
    >
      <div className={clsx("rounded-full", sizeClass, STATUS_COLORS[status])} />
    </div>
  );
}
