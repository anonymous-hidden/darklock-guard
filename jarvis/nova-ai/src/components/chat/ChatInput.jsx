import React, { useState, useRef, useEffect, useCallback } from 'react';
import clsx from 'clsx';

export default function ChatInput({ disabled, streaming, onSend, onAbort, placeholder }) {
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
      <div className="flex gap-2 items-end">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={placeholder || 'Message Nova…  (Shift+Enter for newline)'}
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
