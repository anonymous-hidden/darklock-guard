/**
 * AppearanceTab — Server icon (pfp), banner color, gradient preview, and
 * cool themed preset customisation.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import {
  Camera,
  Palette,
  Sparkles,
  Eye,
  RotateCcw,
  Check,
  ImagePlus,
  Trash2,
  Loader2,
} from "lucide-react";
import clsx from "clsx";
import { useServerStore } from "@/store/serverStore";
import { resizeImage, validateImageFile, IMAGE_ACCEPT } from "@/lib/imageUtils";

// ── Banner color presets (curated gradients) ────────────────────
const BANNER_PRESETS = [
  { label: "Indigo",   color: "#6366f1" },
  { label: "Violet",   color: "#8b5cf6" },
  { label: "Fuchsia",  color: "#d946ef" },
  { label: "Rose",     color: "#f43f5e" },
  { label: "Orange",   color: "#f97316" },
  { label: "Amber",    color: "#f59e0b" },
  { label: "Emerald",  color: "#10b981" },
  { label: "Teal",     color: "#14b8a6" },
  { label: "Cyan",     color: "#06b6d4" },
  { label: "Sky",      color: "#0ea5e9" },
  { label: "Slate",    color: "#64748b" },
  { label: "Zinc",     color: "#71717a" },
];

const GRADIENT_THEMES = [
  { label: "Sunset",     from: "#f43f5e", to: "#f97316" },
  { label: "Ocean",      from: "#06b6d4", to: "#6366f1" },
  { label: "Aurora",     from: "#10b981", to: "#8b5cf6" },
  { label: "Midnight",   from: "#1e1b4b", to: "#312e81" },
  { label: "Sakura",     from: "#f9a8d4", to: "#c084fc" },
  { label: "Cyber",      from: "#06b6d4", to: "#d946ef" },
  { label: "Forest",     from: "#065f46", to: "#10b981" },
  { label: "Lava",       from: "#991b1b", to: "#f97316" },
];

export default function AppearanceTab({ serverId }: { serverId: string }) {
  const servers = useServerStore((s) => s.servers);
  const updateServer = useServerStore((s) => s.updateServer);
  const server = servers.find((s) => s.id === serverId);

  const [icon, setIcon] = useState(server?.icon ?? "");
  const [bannerColor, setBannerColor] = useState(server?.banner_color ?? "#6366f1");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [imageProcessing, setImageProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset local state when server changes
  useEffect(() => {
    setIcon(server?.icon ?? "");
    setBannerColor(server?.banner_color ?? "#6366f1");
    setDirty(false);
  }, [server?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const markDirty = useCallback(() => setDirty(true), []);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateServer(
        serverId,
        undefined,       // name — don't change
        undefined,       // description — don't change
        icon || undefined,
        bannerColor || undefined,
      );
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setIcon(server?.icon ?? "");
    setBannerColor(server?.banner_color ?? "#6366f1");
    setDirty(false);
  };

  // Resize, compress, and set the icon from a file
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validateImageFile(file, 8);
    if (err) {
      setSaveError(err);
      return;
    }
    setImageProcessing(true);
    setSaveError(null);
    try {
      const dataUrl = await resizeImage(file, 256, 256, 0.85);
      setIcon(dataUrl);
      markDirty();
    } catch {
      setSaveError("Failed to process image");
    } finally {
      setImageProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveIcon = () => {
    setIcon("");
    markDirty();
  };

  // Derive initials for icon placeholder
  const initials = (server?.name ?? "S")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="space-y-8 max-w-2xl">
      {saveError && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {saveError}
        </div>
      )}
      {/* ── Live preview ────────────────────────────────────────── */}
      <div>
        <label className="block text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
          <Eye size={11} className="inline mr-1.5 -mt-px" />
          Preview
        </label>
        <div className="relative rounded-xl overflow-hidden border border-white/[0.06] shadow-lg">
          {/* Banner area */}
          <div
            className="h-28 relative"
            style={{
              background: bannerColor.includes(",")
                ? `linear-gradient(135deg, ${bannerColor})`
                : `linear-gradient(135deg, ${bannerColor}, ${bannerColor}88)`,
            }}
          >
            {/* Decorative noise overlay */}
            <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E\")" }} />
          </div>
          {/* Server info bar */}
          <div className="bg-[#0f1117] px-5 pb-4 pt-0 relative">
            {/* Icon overlapping banner */}
            <div
              className="absolute -top-10 left-5 w-20 h-20 rounded-2xl border-4 border-[#0f1117] flex items-center justify-center text-lg font-bold text-white shadow-lg overflow-hidden"
              style={{
                background: icon
                  ? `url(${icon}) center/cover`
                  : `linear-gradient(135deg, ${bannerColor}, ${bannerColor}66)`,
              }}
            >
              {!icon && initials}
            </div>
            <div className="pl-[100px] pt-2">
              <p className="text-base font-semibold text-white/90 truncate">{server?.name ?? "Server"}</p>
              {server?.description ? (
                <p className="text-xs text-white/30 truncate mt-0.5">{server.description}</p>
              ) : (
                <p className="text-xs text-white/15 italic truncate mt-0.5">No server bio set</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Server Icon (PFP) ───────────────────────────────────── */}
      <div>
        <label className="block text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
          <Camera size={11} className="inline mr-1.5 -mt-px" />
          Server Icon
        </label>
        <div className="flex items-center gap-4">
          {/* Current icon preview */}
          <div
            className="w-20 h-20 rounded-2xl border-2 border-dashed border-white/[0.08] flex items-center justify-center overflow-hidden cursor-pointer hover:border-dl-accent/30 transition-all group relative"
            onClick={() => fileInputRef.current?.click()}
          >
            {imageProcessing ? (
              <div className="flex items-center justify-center">
                <Loader2 size={20} className="text-dl-accent animate-spin" />
              </div>
            ) : icon ? (
              <>
                <img src={icon} alt="Server icon" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all">
                  <Camera size={16} className="text-white/80" />
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-1 text-white/20 group-hover:text-white/40 transition-all">
                <ImagePlus size={20} />
                <span className="text-[9px] uppercase tracking-wider font-medium">Upload</span>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            className="hidden"
            onChange={handleFileSelect}
          />
          <div className="space-y-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-dl-accent/10 text-dl-accent text-xs font-medium hover:bg-dl-accent/20 transition-all"
            >
              <Camera size={12} />
              {icon ? "Change Icon" : "Upload Icon"}
            </button>
            {icon && (
              <button
                onClick={handleRemoveIcon}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-red-400/60 text-xs hover:text-red-400 hover:bg-red-500/10 transition-all"
              >
                <Trash2 size={12} />
                Remove
              </button>
            )}
            <p className="text-[10px] text-white/20">PNG, JPG, GIF, or WebP. Max 8 MB. Auto-compressed to 256×256.</p>
          </div>
        </div>

        {/* Paste URL option */}
        <div className="mt-3">
          <label className="block text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-1">
            Or paste image URL
          </label>
          <input
            type="text"
            value={icon}
            onChange={(e) => { setIcon(e.target.value); markDirty(); }}
            placeholder="https://example.com/icon.png"
            className="w-full max-w-md bg-white/[0.04] border border-white/[0.06] rounded-lg px-4 py-2 text-xs text-white/60 placeholder:text-white/15 focus:outline-none focus:ring-1 focus:ring-dl-accent/50 transition-all"
          />
        </div>
      </div>

      {/* ── Banner Color ────────────────────────────────────────── */}
      <div>
        <label className="block text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
          <Palette size={11} className="inline mr-1.5 -mt-px" />
          Banner Color
        </label>

        {/* Solid presets */}
        <div className="flex flex-wrap gap-2 mb-4">
          {BANNER_PRESETS.map(({ label, color }) => (
            <button
              key={color}
              onClick={() => { setBannerColor(color); markDirty(); }}
              className={clsx(
                "w-9 h-9 rounded-xl border-2 transition-all focus:outline-none focus:ring-2 focus:ring-dl-accent/50 relative group",
                bannerColor === color
                  ? "border-white scale-110 shadow-lg"
                  : "border-transparent hover:border-white/30 hover:scale-105"
              )}
              style={{ backgroundColor: color }}
              title={label}
            >
              {bannerColor === color && (
                <Check size={14} className="absolute inset-0 m-auto text-white drop-shadow" />
              )}
            </button>
          ))}
        </div>

        {/* Custom color picker */}
        <div className="flex items-center gap-3 mb-6">
          <input
            type="color"
            value={bannerColor.includes(",") ? "#6366f1" : bannerColor}
            onChange={(e) => { setBannerColor(e.target.value); markDirty(); }}
            className="w-10 h-10 rounded-xl border border-white/[0.06] cursor-pointer bg-transparent"
          />
          <input
            type="text"
            value={bannerColor}
            onChange={(e) => { setBannerColor(e.target.value); markDirty(); }}
            className="w-28 bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2 text-xs text-white/60 font-mono focus:outline-none"
            maxLength={40}
          />
        </div>

        {/* Gradient themes */}
        <label className="block text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
          <Sparkles size={11} className="inline mr-1.5 -mt-px" />
          Gradient Themes
        </label>
        <div className="grid grid-cols-4 gap-2">
          {GRADIENT_THEMES.map(({ label, from, to }) => {
            const gradStr = `${from}, ${to}`;
            const isActive = bannerColor === gradStr;
            return (
              <button
                key={label}
                onClick={() => { setBannerColor(gradStr); markDirty(); }}
                className={clsx(
                  "relative h-14 rounded-xl border-2 overflow-hidden transition-all group",
                  isActive
                    ? "border-white shadow-lg scale-[1.03]"
                    : "border-transparent hover:border-white/20 hover:scale-[1.02]"
                )}
                style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
              >
                <span className="absolute inset-x-0 bottom-0 bg-black/30 backdrop-blur-sm text-[9px] text-white/80 font-medium py-0.5 text-center">
                  {label}
                </span>
                {isActive && (
                  <Check size={16} className="absolute top-1.5 right-1.5 text-white drop-shadow" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Actions ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 pt-2 border-t border-white/[0.04]">
        {dirty ? (
          <>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 rounded-lg bg-dl-accent text-white text-sm font-medium hover:bg-dl-accent/80 disabled:opacity-50 transition-all"
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white/30 text-xs hover:text-white/60 hover:bg-white/[0.04] transition-all"
            >
              <RotateCcw size={12} />
              Reset
            </button>
          </>
        ) : savedFlash ? (
          <span className="flex items-center gap-2 text-sm text-green-400/80 animate-in fade-in">
            <Check size={14} />
            Saved!
          </span>
        ) : (
          <span className="text-xs text-white/20">No unsaved changes</span>
        )}
      </div>
    </div>
  );
}
