/**
 * TypingIndicator — Shows animated "User is typing…" below the message list.
 */
import { motion, AnimatePresence } from "framer-motion";

interface TypingIndicatorProps {
  /** List of user display names currently typing */
  typingUsers: string[];
}

export default function TypingIndicator({ typingUsers }: TypingIndicatorProps) {
  if (typingUsers.length === 0) return null;

  let label: string;
  if (typingUsers.length === 1) {
    label = `${typingUsers[0]} is typing`;
  } else if (typingUsers.length === 2) {
    label = `${typingUsers[0]} and ${typingUsers[1]} are typing`;
  } else if (typingUsers.length === 3) {
    label = `${typingUsers[0]}, ${typingUsers[1]}, and ${typingUsers[2]} are typing`;
  } else {
    label = `${typingUsers.length} people are typing`;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.15 }}
        className="typing-indicator"
      >
        <div className="typing-indicator__dots">
          <span className="typing-indicator__dot" style={{ animationDelay: "0ms" }} />
          <span className="typing-indicator__dot" style={{ animationDelay: "200ms" }} />
          <span className="typing-indicator__dot" style={{ animationDelay: "400ms" }} />
        </div>
        <span className="typing-indicator__text">{label}</span>
      </motion.div>
    </AnimatePresence>
  );
}
