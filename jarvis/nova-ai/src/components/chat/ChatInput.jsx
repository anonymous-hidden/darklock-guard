import React, { useState, useRef, useEffect, useCallback } from 'react';
import clsx from 'clsx';

export default function ChatInput({ disabled, streaming, onSend, onAbort, placeholder, suggestions = [] }) {
  const [value, setValue] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [value]);

  const submit = useCallback(() => {
    const v = value.trim();
    if (!v || disabled) return;
    setValue('');
    onSend?.(v);
  }, [value, disabled, onSend]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-nova-border bg-nova-panel p-3">
      {suggestions.length > 0 && !streaming && (
        <div className="mb-2 flex gap-1.5 overflow-x-auto">
          {suggestions.map((s) => (
            <button
              key={s.label}
              type="button"
              disabled={disabled}
              onClick={() => onSend?.(s.prompt)}
              className="shrink-0 rounded border border-nova-border bg-nova-bg/60 px-2 py-1 text-[11px] text-nova-muted hover:border-nova-accent/50 hover:text-nova-accent disabled:opacity-50"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-end">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={placeholder || 'Message Jarvis…  (Shift+Enter for newline)'}
          disabled={disabled}
          className={clsx(
            'nova-input resize-none min-h-[40px] max-h-[200px] flex-1 font-sans',
            disabled && 'opacity-60',
          )}
        />
        {streaming ? (
          <button onClick={onAbort} className="nova-btn-danger h-10">Stop</button>
        ) : (
          <button onClick={submit} disabled={disabled || !value.trim()} className="nova-btn-primary h-10">
            Send
          </button>
        )}
      </div>
    </div>
  );
}
