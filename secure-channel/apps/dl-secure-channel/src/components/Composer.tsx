/**
 * Composer — standalone message input component with attachment support.
 */
import { useState, useRef, useCallback } from "react";

interface Props {
  onSend: (text: string) => void;
  onAttachment?: (filePath: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function Composer({
  onSend,
  onAttachment,
  disabled = false,
  placeholder = "Type a message...",
}: Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    inputRef.current?.focus();
  }, [text, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex items-end gap-2 p-3 bg-gray-900 border-t border-gray-800">
      {onAttachment && (
        <button
          onClick={() => {
            // In Tauri, use dialog plugin to pick file
            // For now, stub
          }}
          disabled={disabled}
          className="p-2 hover:bg-gray-800 rounded text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
          title="Attach file"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
            />
          </svg>
        </button>
      )}

      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className="flex-1 dl-input resize-none min-h-[40px] max-h-32 overflow-y-auto"
        style={{
          height: "auto",
          minHeight: "40px",
        }}
        onInput={(e) => {
          const target = e.target as HTMLTextAreaElement;
          target.style.height = "auto";
          target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
        }}
      />

      <button
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        className="p-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-white transition-colors"
        title="Send"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
          />
        </svg>
      </button>
    </div>
  );
}
