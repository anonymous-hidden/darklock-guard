import type { ReactNode } from "react";
import clsx from "clsx";

interface MessageComposerBarProps {
  disabled?: boolean;
  onAttach?: () => void;
  onHash?: () => void;
  onEmoji?: () => void;
  hashActive?: boolean;
  children: ReactNode;
  rightSlot?: ReactNode;
}

export default function MessageComposerBar({
  disabled = false,
  onAttach,
  onHash,
  onEmoji,
  hashActive = false,
  children,
  rightSlot,
}: MessageComposerBarProps) {
  return (
    <div className={`message-input ${disabled ? "message-input--disabled" : ""}`}>
      <button
        className="message-input__attach"
        title="Attach"
        disabled={disabled}
        onClick={onAttach}
      >
        +
      </button>
      <button
        className={clsx("message-input__md-toggle", hashActive && "message-input__md-toggle--active")}
        title="Commands / formatting"
        disabled={disabled}
        onClick={onHash}
      >
        #
      </button>
      {children}
      <div className="message-input__right">
        <button
          className="message-input__emoji"
          title="Emoji"
          disabled={disabled}
          onClick={onEmoji}
        >
          :)
        </button>
        {rightSlot}
      </div>
    </div>
  );
}
