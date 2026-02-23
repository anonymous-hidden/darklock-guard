/**
 * EmojiPicker — Standalone emoji picker component with search and categories.
 * Used for reactions and message composition.
 */
import { useState, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const EMOJI_CATEGORIES: Record<string, string[]> = {
  "Frequent": ["👍","❤️","😂","🔥","😊","🎉","💪","👀","✨","🙏","🤔","😍","💯","🥳","😎","🤝"],
  "Smileys": ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🫡","🤐","🤨","😐","😑","😶","🫥","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎","🤓","🧐","😕","🫤","😟","🙁","😮","😯","😲","😳","🥺","🥹","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈","👿","💀","☠️","💩","🤡","👹","👺","👻","👽","👾","🤖"],
  "Gestures": ["👋","🤚","🖐️","✋","🖖","🫱","🫲","🫳","🫴","👌","🤌","🤏","✌️","🤞","🫰","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️","🫵","👍","👎","👊","✊","🤛","🤜","👏","🙌","🫶","👐","🤲","🤝","🙏","✍️","💅","🤳","💪"],
  "Hearts": ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❤️‍🔥","❤️‍🩹","❣️","💕","💞","💓","💗","💖","💘","💝","💟"],
  "Objects": ["🎉","🎊","🎈","🎁","🎀","🏆","🥇","🥈","🥉","🔥","⭐","🌟","✨","💫","🌈","🎵","🎶","🎤","🎧","🎸","🎹","📱","💻","🖥️","💡","📷","📹","📚","📖","📝","📌","📎","✂️","🔒","🔓","🔑","🗝️","🛡️","⚔️"],
  "Food": ["🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🍕","🍔","🍟","🌭","🥪","🌮","🌯","🍣","🍱","🍤","🍙","🍧","🍨","🍦","🥧","🧁","🍰","🎂","☕","🍵","🥤","🧋","🍺","🍻","🥂","🍷"],
  "Nature": ["🌿","🍀","🌸","🌺","🌻","🌹","🌷","🌼","🌱","🌲","🌳","🌴","🌵","🍁","🍂","🍃","🌾","💐","🪻","🪷","🍄","🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁"],
};

interface EmojiPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
  /** Position anchor */
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
}

export default function EmojiPicker({ open, onClose, onSelect, position = "bottom-right" }: EmojiPickerProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Frequent");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  // Focus search on open
  useEffect(() => {
    if (open) {
      setSearch("");
      searchRef.current?.focus();
    }
  }, [open]);

  const allEmojis = Object.entries(EMOJI_CATEGORIES).flatMap(([, emojis]) => emojis);
  const filteredEmojis = search
    ? [...new Set(allEmojis)] // dedupe for search
    : EMOJI_CATEGORIES[category] ?? [];

  const positionClass =
    position === "bottom-right" ? "bottom-full right-0 mb-2" :
    position === "bottom-left" ? "bottom-full left-0 mb-2" :
    position === "top-right" ? "top-full right-0 mt-2" :
    "top-full left-0 mt-2";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.12 }}
          className={`emoji-picker absolute ${positionClass} z-50`}
        >
          {/* Search */}
          <div className="emoji-picker__search">
            <Search size={14} className="text-white/30" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search emoji…"
              className="emoji-picker__search-input"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-white/30 hover:text-white/60">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Category tabs */}
          {!search && (
            <div className="emoji-picker__tabs">
              {Object.keys(EMOJI_CATEGORIES).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`emoji-picker__tab ${category === cat ? "emoji-picker__tab--active" : ""}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {/* Emoji grid */}
          <div className="emoji-picker__grid">
            {filteredEmojis.map((emoji, i) => (
              <button
                key={`${emoji}-${i}`}
                className="emoji-picker__emoji"
                onClick={() => {
                  onSelect(emoji);
                  onClose();
                }}
                title={emoji}
              >
                {emoji}
              </button>
            ))}
            {filteredEmojis.length === 0 && (
              <div className="emoji-picker__empty">No emoji found</div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
