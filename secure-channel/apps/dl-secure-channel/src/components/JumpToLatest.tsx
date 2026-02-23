/**
 * JumpToLatest — Floating pill that appears when the user scrolls up
 * from the bottom of messages, allowing instant scroll-back.
 */
import { ArrowDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface JumpToLatestProps {
  /** Whether the button is visible */
  visible: boolean;
  /** Number of unread messages below the viewport */
  unreadCount?: number;
  /** Click handler */
  onClick: () => void;
}

export default function JumpToLatest({ visible, unreadCount = 0, onClick }: JumpToLatestProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.15 }}
          className="jump-to-latest"
          onClick={onClick}
        >
          {unreadCount > 0 && (
            <span className="jump-to-latest__badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
          )}
          <ArrowDown size={14} />
          <span>Jump to Latest</span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
