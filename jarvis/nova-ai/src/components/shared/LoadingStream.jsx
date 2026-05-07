import React from 'react';
import clsx from 'clsx';

/**
 * LoadingStream — small inline indicator: 3 dots that pulse, plus an
 * optional label.
 */
export default function LoadingStream({ label = 'Working', className }) {
  return (
    <div className={clsx('inline-flex items-center gap-2 text-nova-muted text-xs', className)}>
      <span className="font-mono">{label}</span>
      <span className="flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-nova-accent animate-pulse-soft" />
        <span className="w-1.5 h-1.5 rounded-full bg-nova-accent animate-pulse-soft [animation-delay:200ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-nova-accent animate-pulse-soft [animation-delay:400ms]" />
      </span>
    </div>
  );
}
