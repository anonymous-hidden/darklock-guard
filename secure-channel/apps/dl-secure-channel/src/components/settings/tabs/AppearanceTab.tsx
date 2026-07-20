/**
 * AppearanceTab — themes, accent color, font size, message density, live preview.
 */
import { useEffect, useState } from "react";
import { useSettingsStore } from "@/store/settingsStore";
import { setSetting } from "@/lib/tauri";
import clsx from "clsx";
import { Monitor, Moon, Sparkles, Type, Minus, Plus, Check, RotateCcw } from "lucide-react";

/* ── Theme catalogue ─────────────────────────────────────────────── */
const THEMES = [
  { id: "dark",     label: "Dark",     desc: "Classic dark theme",       bg: "#141720", surface: "#1c1f2e", elevated: "#252840", icon: Moon },
  { id: "darker",   label: "Darker",   desc: "Extra dim, low blue light",bg: "#0a0b0f", surface: "#111218", elevated: "#1a1b24", icon: Moon },
  { id: "midnight", label: "Midnight", desc: "GitHub-inspired dark",     bg: "#0d1117", surface: "#161b22", elevated: "#21262d", icon: Sparkles },
  { id: "amoled",   label: "AMOLED",   desc: "Pure black for OLED",      bg: "#000000", surface: "#0a0a0a", elevated: "#141414", icon: Moon },
  { id: "nord",     label: "Nord",     desc: "Arctic, inspired by Nord", bg: "#2e3440", surface: "#3b4252", elevated: "#434c5e", icon: Sparkles },
  { id: "mocha",    label: "Mocha",    desc: "Warm, Catppuccin-inspired",bg: "#1e1e2e", surface: "#26263a", elevated: "#313244", icon: Sparkles },
  { id: "system",   label: "System",   desc: "Follows OS light/dark",    bg: "linear-gradient(135deg,#0a0b0f 50%,#f5f7fa 50%)", surface: "#111218", elevated: "#1a1b24", icon: Monitor },
] as const;

const ACCENTS = [
  { id: "#6366f1", label: "Indigo" },
  { id: "#8b5cf6", label: "Violet" },
  { id: "#06b6d4", label: "Cyan" },
  { id: "#10b981", label: "Emerald" },
  { id: "#f59e0b", label: "Amber" },
  { id: "#ec4899", label: "Pink" },
  { id: "#ef4444", label: "Red" },
  { id: "#3b82f6", label: "Blue" },
  { id: "#14b8a6", label: "Teal" },
  { id: "#f97316", label: "Orange" },
];

const DENSITIES = [
  { id: "cozy" as const,    label: "Cozy",    desc: "More spacing, bigger avatars" },
  { id: "compact" as const, label: "Compact", desc: "Reduced spacing, no avatars" },
  { id: "spacious" as const,label: "Spacious",desc: "Extra breathing room" },
];

/* ── Helpers ─────────────────────────────────────────────────────── */
function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

/* ── Toggle component ────────────────────────────────────────────── */
function Toggle({ label, description, checked, onChange }: {
  label: string; description?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-white/[0.05] last:border-0">
      <div className="flex-1 mr-6">
        <p className="text-sm text-white/75">{label}</p>
        {description && <p className="text-xs text-white/30 mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${checked ? "bg-dl-accent" : "bg-white/10"}`}
      >
        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

/* ═══════════════════════════════ COMPONENT ═════════════════════════ */
export default function AppearanceTab() {
  const { appearance, updateAppearance } = useSettingsStore();
  const save = (k: string, v: string) => setSetting(k, v).catch(() => {});

  const [hoveredTheme, setHoveredTheme] = useState<string | null>(null);

  const DEFAULTS = { theme: "darker" as const, accentColor: "#6366f1", compactMode: false, fontSize: 14, messageDensity: "cozy" as const };

  const handleResetDefaults = () => {
    updateAppearance(DEFAULTS);
    document.documentElement.setAttribute("data-theme", DEFAULTS.theme);
    applyAccent(DEFAULTS.accentColor);
    applyFontSize(DEFAULTS.fontSize);
    save("theme", DEFAULTS.theme);
    save("accent_color", DEFAULTS.accentColor);
    save("compact_mode", "false");
    save("font_size", "14");
    save("message_density", "cozy");
  };

  /** Apply accent to CSS vars */
  const applyAccent = (color: string) => {
    document.documentElement.style.setProperty("--dl-accent", color);
    document.documentElement.style.setProperty("--dl-accent-rgb", hexToRgb(color));
  };

  /** Apply font size to root */
  const applyFontSize = (size: number) => {
    document.documentElement.style.setProperty("--dl-font-size", `${size}px`);
    document.documentElement.style.fontSize = `${size}px`;
  };

  /** Apply saved settings on first render */
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", appearance.theme);
    applyAccent(appearance.accentColor);
    applyFontSize(appearance.fontSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Preview theme data (hovered or current) ─────────────────── */
  const previewId = hoveredTheme ?? appearance.theme;
  const previewTheme = THEMES.find((t) => t.id === previewId) ?? THEMES[1];

  return (
    <div className="flex gap-6">
      {/* ── Left: Controls ─────────────────────────────────────── */}
      <div className="flex-1 space-y-5 min-w-0">

        {/* Themes */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30">Theme</h3>
          <div className="grid grid-cols-2 gap-2.5">
            {THEMES.map((t) => {
              const Icon = t.icon;
              const active = appearance.theme === t.id;
              return (
                <button
                  key={t.id}
                  onMouseEnter={() => setHoveredTheme(t.id)}
                  onMouseLeave={() => setHoveredTheme(null)}
                  onClick={() => {
                    updateAppearance({ theme: t.id as typeof appearance.theme });
                    save("theme", t.id);
                    document.documentElement.setAttribute("data-theme", t.id);
                  }}
                  className={clsx(
                    "flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left",
                    active
                      ? "border-dl-accent bg-dl-accent/5"
                      : "border-white/[0.06] bg-white/[0.02] hover:border-white/20"
                  )}
                >
                  {/* Color swatch */}
                  <div className="relative shrink-0 w-10 h-10 rounded-lg overflow-hidden border border-white/10"
                    style={{ background: t.bg }}>
                    {/* Surface / elevated mini bars */}
                    <div className="absolute bottom-0 left-0 right-0 h-3" style={{ background: t.surface }} />
                    <div className="absolute bottom-0 left-0 w-3 h-3" style={{ background: t.elevated }} />
                    {active && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <Check className="w-4 h-4 text-dl-accent" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Icon className="w-3.5 h-3.5 text-white/40" />
                      <span className="text-sm text-white/80 font-medium">{t.label}</span>
                    </div>
                    <span className="text-[11px] text-white/30 leading-tight">{t.desc}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Accent Color */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30">Accent Color</h3>
          <div className="flex items-center gap-2.5 flex-wrap">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  updateAppearance({ accentColor: a.id });
                  save("accent_color", a.id);
                  applyAccent(a.id);
                }}
                title={a.label}
                className={clsx(
                  "w-8 h-8 rounded-full transition-all relative",
                  appearance.accentColor === a.id
                    ? "ring-2 ring-white/60 ring-offset-2 ring-offset-[#0f1117] scale-110"
                    : "hover:scale-110"
                )}
                style={{ backgroundColor: a.id }}
              >
                {appearance.accentColor === a.id && (
                  <Check className="absolute inset-0 m-auto w-4 h-4 text-white drop-shadow" />
                )}
              </button>
            ))}
          </div>
          <p className="text-xs text-white/30">
            Current: <span className="text-white/50">{ACCENTS.find(a => a.id === appearance.accentColor)?.label ?? "Custom"}</span>
          </p>
        </div>

        {/* Font Size */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30">
              <span className="inline-flex items-center gap-1.5"><Type className="w-3.5 h-3.5" /> Font Size</span>
            </h3>
            <span className="text-sm text-white/60 font-mono">{appearance.fontSize}px</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const s = Math.max(12, appearance.fontSize - 1);
                updateAppearance({ fontSize: s });
                save("font_size", String(s));
                applyFontSize(s);
              }}
              disabled={appearance.fontSize <= 12}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors"
            >
              <Minus className="w-4 h-4 text-white/60" />
            </button>
            <input
              type="range"
              min={12}
              max={20}
              step={1}
              value={appearance.fontSize}
              onChange={(e) => {
                const s = Number(e.target.value);
                updateAppearance({ fontSize: s });
                applyFontSize(s);
              }}
              onMouseUp={(e) => save("font_size", (e.target as HTMLInputElement).value)}
              className="flex-1 h-1.5 rounded-full appearance-none bg-white/10 accent-dl-accent cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-dl-accent [&::-webkit-slider-thumb]:shadow-lg
                [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white/20
                [&::-webkit-slider-thumb]:cursor-pointer"
            />
            <button
              onClick={() => {
                const s = Math.min(20, appearance.fontSize + 1);
                updateAppearance({ fontSize: s });
                save("font_size", String(s));
                applyFontSize(s);
              }}
              disabled={appearance.fontSize >= 20}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors"
            >
              <Plus className="w-4 h-4 text-white/60" />
            </button>
          </div>
          <div className="flex justify-between text-[10px] text-white/20 px-1">
            <span>12px</span><span>14px</span><span>16px</span><span>18px</span><span>20px</span>
          </div>
        </div>

        {/* Message Density */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30">Message Density</h3>
          <div className="grid grid-cols-3 gap-2">
            {DENSITIES.map((d) => (
              <button
                key={d.id}
                onClick={() => {
                  updateAppearance({ messageDensity: d.id });
                  save("message_density", d.id);
                }}
                className={clsx(
                  "flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all",
                  appearance.messageDensity === d.id
                    ? "border-dl-accent bg-dl-accent/5"
                    : "border-white/[0.06] bg-white/[0.02] hover:border-white/20"
                )}
              >
                {/* Mini density illustration */}
                <div className="w-full space-y-[3px]">
                  {[1,2,3].map((i) => (
                    <div key={i} className="flex items-center gap-1">
                      {d.id !== "compact" && <div className="w-2 h-2 rounded-full bg-white/20 shrink-0" />}
                      <div className={clsx("rounded-full bg-white/15", {
                        "h-1.5 w-full": d.id === "compact",
                        "h-2 w-full": d.id === "cozy",
                        "h-2.5 w-full": d.id === "spacious",
                      })} />
                    </div>
                  ))}
                </div>
                <span className="text-xs text-white/60 font-medium">{d.label}</span>
                <span className="text-[10px] text-white/25 leading-tight text-center">{d.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Compact Mode Toggle */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-5 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30 pt-3 pb-1">Display</h3>
          <Toggle
            label="Compact Mode"
            description="Reduce padding and font sizes for a denser layout"
            checked={appearance.compactMode}
            onChange={(v) => { updateAppearance({ compactMode: v }); save("compact_mode", String(v)); }}
          />
        </div>

        {/* Restore defaults */}
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-white/50">Restore to defaults</p>
            <p className="text-xs text-white/25 mt-0.5">Darker theme · Indigo accent · 14px · Cozy</p>
          </div>
          <button
            onClick={handleResetDefaults}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 hover:bg-white/[0.04] transition-all shrink-0"
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>
      </div>

      {/* ── Right: Live Preview ────────────────────────────────── */}
      <div className="w-[240px] shrink-0 sticky top-0 self-start space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30">Preview</h3>

        {/* Mini chat preview */}
        <div className="rounded-xl overflow-hidden border border-white/[0.08]"
          style={{ background: previewTheme.bg.startsWith("linear") ? previewTheme.bg : previewTheme.bg }}>

          {/* Header bar */}
          <div className="px-3 py-2 flex items-center gap-2 border-b border-white/[0.06]"
            style={{ background: previewTheme.surface }}>
            <div className="w-2 h-2 rounded-full" style={{ background: appearance.accentColor }} />
            <div className="h-2 w-14 rounded-full bg-white/20" />
          </div>

          {/* Messages area */}
          <div className="p-3 space-y-3" style={{ background: previewTheme.bg.startsWith("linear") ? "#0a0b0f" : previewTheme.bg }}>
            {/* Message 1 */}
            <div className="flex items-start gap-2">
              <div className="w-6 h-6 rounded-full shrink-0 bg-white/15" />
              <div className="space-y-1 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-10 rounded-full" style={{ background: appearance.accentColor, opacity: 0.8 }} />
                  <div className="h-1 w-6 rounded-full bg-white/10" />
                </div>
                <div className="h-2 w-full rounded bg-white/[0.06]" style={{ fontSize: `${appearance.fontSize * 0.6}px` }} />
                <div className="h-2 w-3/4 rounded bg-white/[0.04]" />
              </div>
            </div>
            {/* Message 2 */}
            <div className="flex items-start gap-2">
              <div className="w-6 h-6 rounded-full shrink-0" style={{ background: appearance.accentColor, opacity: 0.3 }} />
              <div className="space-y-1 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-12 rounded-full bg-white/20" />
                  <div className="h-1 w-6 rounded-full bg-white/10" />
                </div>
                <div className="h-2 w-5/6 rounded bg-white/[0.06]" />
              </div>
            </div>
          </div>

          {/* Input bar */}
          <div className="px-3 py-2 border-t border-white/[0.06]" style={{ background: previewTheme.surface }}>
            <div className="rounded-lg px-3 py-1.5 flex items-center gap-2"
              style={{ background: previewTheme.elevated }}>
              <div className="w-3 h-3 rounded-full bg-white/10" />
              <div className="h-1.5 w-16 rounded-full bg-white/10" />
              <div className="ml-auto w-4 h-4 rounded"
                style={{ background: appearance.accentColor, opacity: 0.6 }} />
            </div>
          </div>
        </div>

        {/* Color tokens */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 space-y-2">
          <p className="text-[10px] text-white/25 uppercase tracking-widest">Colors</p>
          {[
            { label: "Background", color: previewTheme.bg },
            { label: "Surface", color: previewTheme.surface },
            { label: "Elevated", color: previewTheme.elevated },
            { label: "Accent", color: appearance.accentColor },
          ].map((c) => (
            <div key={c.label} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded border border-white/10 shrink-0"
                style={{ background: c.color }} />
              <span className="text-[11px] text-white/40">{c.label}</span>
              <span className="text-[10px] text-white/20 ml-auto font-mono">
                {c.color.startsWith("linear") ? "auto" : c.color}
              </span>
            </div>
          ))}
        </div>

        {/* Font preview */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 space-y-1">
          <p className="text-[10px] text-white/25 uppercase tracking-widest">Font Preview</p>
          <p className="text-white/70 leading-snug" style={{ fontSize: `${appearance.fontSize}px` }}>
            The quick brown fox jumps over the lazy dog.
          </p>
          <p className="text-white/30 leading-snug" style={{ fontSize: `${Math.max(10, appearance.fontSize - 2)}px` }}>
            Secondary text at {appearance.fontSize - 2}px
          </p>
        </div>
      </div>
    </div>
  );
}
