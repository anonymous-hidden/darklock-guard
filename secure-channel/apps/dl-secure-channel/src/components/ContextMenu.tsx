/**
 * ContextMenu — generic right-click floating menu.
 *
 * Usage:
 *   <ContextMenu x={pos.x} y={pos.y} items={[...]} onClose={() => setPos(null)} />
 *
 * Items can be actions or horizontal separators:
 *   { label, icon, onClick, danger?, disabled? }   ← action
 *   { separator: true }                            ← divider line
 */
import { useEffect, useRef } from "react";
import clsx from "clsx";

export interface ContextMenuAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean; // shows a ✓ tick when true
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuAction | ContextMenuSeparator;

interface Props {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // Use capture so we catch it before any other handler
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Clamp to viewport so it never renders off-screen
  const clampedX = Math.min(x, window.innerWidth  - 200);
  const clampedY = Math.min(y, window.innerHeight - 300);

  return (
    <div
      ref={ref}
      style={{ position: "fixed", top: clampedY, left: clampedX, zIndex: 9999 }}
      className="w-52 rounded-xl border border-dl-border bg-dl-surface shadow-[0_8px_32px_rgba(0,0,0,0.45)] py-1.5 overflow-hidden"
    >
      {items.map((entry, i) => {
        if ("separator" in entry) {
          return <div key={i} className="my-1.5 mx-2 border-t border-dl-border/50" />;
        }
        const { label, icon, onClick, danger, disabled, checked } = entry;
        return (
          <button
            key={i}
            disabled={disabled}
            onMouseDown={(e) => { e.stopPropagation(); }}
            onClick={() => { onClick(); onClose(); }}
            className={clsx(
              "flex w-full items-center gap-2.5 px-3 py-[7px] text-[13px] transition-colors",
              disabled && "opacity-40 cursor-not-allowed pointer-events-none",
              !disabled && danger  && "text-dl-danger  hover:bg-dl-danger/10  font-medium",
              !disabled && !danger && "text-dl-text    hover:bg-dl-elevated  font-normal"
            )}
          >
            <span className="shrink-0 w-4 flex items-center justify-center">{icon}</span>
            <span className="flex-1 text-left truncate">{label}</span>
            {checked && (
              <span className="text-dl-success text-xs font-bold ml-1">✓</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
