/**
 * SlashCommandMenu — Autocomplete overlay for "/"‑triggered slash commands.
 * Shows when user types "/" in the message input and filters as they type.
 */
import React, { useEffect, useRef } from "react";
import { useCommandStore } from "@/store/commandStore";
import clsx from "clsx";
import {
  Shield,
  Gamepad2,
  Wrench,
  Server,
  Lock,
  ChevronRight,
} from "lucide-react";

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  moderation: <Shield size={14} className="text-red-400" />,
  fun: <Gamepad2 size={14} className="text-yellow-400" />,
  utility: <Wrench size={14} className="text-blue-400" />,
  server: <Server size={14} className="text-green-400" />,
  security: <Lock size={14} className="text-purple-400" />,
};

const CATEGORY_LABELS: Record<string, string> = {
  moderation: "Moderation",
  fun: "Fun & Games",
  utility: "Utility",
  server: "Server",
  security: "Security",
};

interface SlashCommandMenuProps {
  /** Bottom offset from the input area (so it floats above) */
  bottomOffset?: number;
}

export default function SlashCommandMenu({ bottomOffset = 8 }: SlashCommandMenuProps) {
  const {
    menuOpen,
    suggestions,
    highlightIndex,
    activeCommand,
    activeParamIndex,
    selectSuggestion,
    // closeMenu,
  } = useCommandStore();

  const listRef = useRef<HTMLDivElement>(null);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${highlightIndex}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [highlightIndex]);

  if (!menuOpen && !activeCommand) return null;

  // ── Param helper (shows inline when a command is selected) ──
  if (activeCommand) {
    const params = activeCommand.params;
    if (params.length === 0) return null;

    return (
      <div
        className="slash-command-menu slash-command-menu--params"
        style={{ bottom: `${bottomOffset}px` }}
      >
        <div className="slash-command-menu__header">
          <span className="slash-command-menu__cmd-name">/{activeCommand.name}</span>
          <span className="slash-command-menu__cmd-desc">{activeCommand.description}</span>
        </div>
        <div className="slash-command-menu__params">
          {params.map((p, i) => (
            <div
              key={p.name}
              className={clsx(
                "slash-command-menu__param",
                i === activeParamIndex && "slash-command-menu__param--active"
              )}
            >
              <span className="slash-command-menu__param-name">
                {p.name}
                {p.required && <span className="text-red-400">*</span>}
              </span>
              <span className="slash-command-menu__param-type">{p.type}</span>
              {p.description && (
                <span className="slash-command-menu__param-desc">— {p.description}</span>
              )}
              {p.choices && p.choices.length > 0 && (
                <div className="slash-command-menu__param-choices">
                  {p.choices.map((c) => (
                    <span key={c.value} className="slash-command-menu__choice">{c.name}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Main autocomplete list ──
  // Group suggestions by category
  const grouped = suggestions.reduce<Record<string, typeof suggestions>>(
    (acc, cmd) => {
      (acc[cmd.category] ??= []).push(cmd);
      return acc;
    },
    {}
  );

  let flatIndex = 0;

  return (
    <div
      className="slash-command-menu"
      style={{ bottom: `${bottomOffset}px` }}
      ref={listRef}
    >
      <div className="slash-command-menu__title">
        <span>Commands</span>
      </div>
      <div className="slash-command-menu__list">
        {Object.entries(grouped).map(([category, cmds]) => (
          <div key={category} className="slash-command-menu__group">
            <div className="slash-command-menu__group-header">
              {CATEGORY_ICONS[category]}
              <span>{CATEGORY_LABELS[category] ?? category}</span>
            </div>
            {cmds.map((cmd) => {
              const idx = flatIndex++;
              return (
                <button
                  key={cmd.name}
                  data-index={idx}
                  className={clsx(
                    "slash-command-menu__item",
                    idx === highlightIndex && "slash-command-menu__item--active"
                  )}
                  onClick={() => selectSuggestion(idx)}
                  onMouseEnter={() => {/* could set highlight */}}
                >
                  <span className="slash-command-menu__item-name">/{cmd.name}</span>
                  <span className="slash-command-menu__item-desc">{cmd.description}</span>
                  {cmd.params.length > 0 && (
                    <ChevronRight size={12} className="text-white/20 ml-auto shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {suggestions.length === 0 && (
        <div className="slash-command-menu__empty">No commands found</div>
      )}
    </div>
  );
}
