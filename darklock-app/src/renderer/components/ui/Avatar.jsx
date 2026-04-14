import React from 'react';

const sizes = {
  xs: 'w-5 h-5 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-16 h-16 text-lg',
  xl: 'w-20 h-20 text-xl'
};

const statusColors = {
  online: 'bg-success',
  away: 'bg-warning',
  offline: 'bg-text-muted',
  dnd: 'bg-danger'
};

export default function Avatar({ src, alt, username, size = 'md', status, className = '' }) {
  const sizeClass = sizes[size] || sizes.md;
  const initial = (username || alt || '?')[0].toUpperCase();

  // Simple hash for consistent bg color per user
  const hash = (username || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const hues = [210, 260, 330, 150, 40, 180, 300, 20, 120, 280];
  const hue = hues[hash % hues.length];

  return (
    <div className={`relative inline-flex shrink-0 ${className}`}>
      {src ? (
        <img
          src={src}
          alt={alt || username || 'avatar'}
          className={`${sizeClass} rounded-full object-cover`}
        />
      ) : (
        <div
          className={`${sizeClass} rounded-full flex items-center justify-center font-semibold text-white`}
          style={{ backgroundColor: `hsl(${hue}, 55%, 50%)` }}
        >
          {initial}
        </div>
      )}
      {status && (
        <div
          className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#2b2d31] ${statusColors[status] || statusColors.offline}`}
        />
      )}
    </div>
  );
}
