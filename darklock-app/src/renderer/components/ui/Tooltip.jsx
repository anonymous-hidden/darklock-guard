import React, { useState, useRef } from 'react';

export default function Tooltip({ children, text, position = 'top', delay = 300 }) {
  const [visible, setVisible] = useState(false);
  const timeout = useRef(null);

  const show = () => {
    timeout.current = setTimeout(() => setVisible(true), delay);
  };
  const hide = () => {
    clearTimeout(timeout.current);
    setVisible(false);
  };

  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2'
  };

  const arrows = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-[#111214] border-x-transparent border-b-transparent border-4',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-[#111214] border-x-transparent border-t-transparent border-4',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-[#111214] border-y-transparent border-r-transparent border-4',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-[#111214] border-y-transparent border-l-transparent border-4'
  };

  return (
    <div className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && text && (
        <div className={`absolute z-50 pointer-events-none ${positions[position]}`}>
          <div className="relative bg-[#111214] text-text-primary text-xs font-medium px-3 py-1.5 rounded shadow-lg whitespace-nowrap">
            {text}
            <div className={`absolute w-0 h-0 ${arrows[position]}`} />
          </div>
        </div>
      )}
    </div>
  );
}
