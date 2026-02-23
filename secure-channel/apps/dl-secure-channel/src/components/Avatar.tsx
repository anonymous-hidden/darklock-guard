import { useEffect } from "react";
import clsx from "clsx";
import { useProfileStore } from "@/store/profileStore";

interface AvatarProps {
  userId: string;
  fallbackName?: string;
  size?: number;
  className?: string;
  profileColor?: string | null;
}

export default function Avatar({
  userId,
  fallbackName = "U",
  size = 32,
  className,
  profileColor,
}: AvatarProps) {
  const profile = useProfileStore((s) => s.profiles[userId]);
  const fetchProfile = useProfileStore((s) => s.fetchProfile);

  useEffect(() => {
    if (userId && !profile) fetchProfile(userId).catch(() => {});
  }, [userId, profile, fetchProfile]);

  const avatar = profile?.avatar ?? null;
  const initials = (fallbackName || "U").charAt(0).toUpperCase();
  const bg = profile?.profile_color ?? profileColor ?? "#6366f1";

  if (avatar) {
    return (
      <img
        src={avatar}
        alt={fallbackName}
        className={clsx("rounded-full object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={clsx("rounded-full flex items-center justify-center text-white font-semibold", className)}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${bg}88, ${bg}44)`,
      }}
    >
      {initials}
    </div>
  );
}
