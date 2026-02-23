/**
 * ReactionBar — Displays emoji reactions on a message and "Add Reaction" button.
 * Clicking a reaction toggles the current user's reaction.
 */
import { useState } from "react";
import { Smile, Plus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import clsx from "clsx";

export interface Reaction {
  emoji: string;
  count: number;
  /** Whether the current user has reacted with this emoji */
  me: boolean;
  /** User IDs who reacted (for tooltip) */
  users?: string[];
}

interface ReactionBarProps {
  reactions: Reaction[];
  onToggle: (emoji: string) => void;
  onAddReaction?: () => void;
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👀"];

export default function ReactionBar({ reactions, onToggle, onAddReaction }: ReactionBarProps) {
  const [showQuick, setShowQuick] = useState(false);

  return (
    <div className="reaction-bar">
      {/* Existing reactions */}
      {reactions.map((r) => (
        <motion.button
          key={r.emoji}
          layout
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.8, opacity: 0 }}
          className={clsx(
            "reaction-bar__pill",
            r.me && "reaction-bar__pill--active"
          )}
          onClick={() => onToggle(r.emoji)}
          title={r.users?.join(", ") ?? `${r.count} reaction${r.count !== 1 ? "s" : ""}`}
        >
          <span className="reaction-bar__emoji">{r.emoji}</span>
          <span className="reaction-bar__count">{r.count}</span>
        </motion.button>
      ))}

      {/* Add reaction button */}
      <div className="relative">
        <button
          className="reaction-bar__add"
          onClick={() => setShowQuick(!showQuick)}
          title="Add Reaction"
        >
          <Plus size={12} />
          <Smile size={12} />
        </button>

        {/* Quick reaction picker */}
        <AnimatePresence>
          {showQuick && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 4 }}
              transition={{ duration: 0.12 }}
              className="reaction-bar__quick-picker"
            >
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  className="reaction-bar__quick-btn"
                  onClick={() => {
                    onToggle(emoji);
                    setShowQuick(false);
                  }}
                >
                  {emoji}
                </button>
              ))}
              {onAddReaction && (
                <button
                  className="reaction-bar__quick-btn reaction-bar__quick-btn--more"
                  onClick={() => {
                    onAddReaction();
                    setShowQuick(false);
                  }}
                  title="More…"
                >
                  <Smile size={16} />
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
