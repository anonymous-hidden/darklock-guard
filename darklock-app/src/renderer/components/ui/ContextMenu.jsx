import React, { useState, useEffect, useRef } from 'react';

export default function ContextMenu({ items, children }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const menuRef = useRef(null);

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Ensure menu stays within viewport
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - items.length * 36 - 16);
    setPos({ x, y });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [open]);

  return (
    <>
      <div onContextMenu={handleContextMenu}>{children}</div>
      {open && (
        <div
          ref={menuRef}
          className="fixed z-[100] bg-[#111214] rounded-md shadow-xl border border-white/5 py-1.5 min-w-[180px]"
          style={{ left: pos.x, top: pos.y }}
        >
          {items.map((item, i) => {
            if (item.separator) {
              return <div key={i} className="h-px bg-white/10 mx-2 my-1" />;
            }
            return (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  item.onClick?.();
                }}
                disabled={item.disabled}
                className={`w-full text-left px-2 mx-1.5 py-1.5 text-sm rounded-sm flex items-center gap-2 transition-colors ${
                  item.danger
                    ? 'text-danger hover:bg-danger hover:text-white'
                    : 'text-text-secondary hover:bg-accent hover:text-white'
                } disabled:opacity-40 disabled:pointer-events-none`}
                style={{ width: 'calc(100% - 12px)' }}
              >
                {item.icon && <span className="w-4 text-center text-xs">{item.icon}</span>}
                {item.label}
                {item.shortcut && (
                  <span className="ml-auto text-[11px] text-text-muted">{item.shortcut}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
