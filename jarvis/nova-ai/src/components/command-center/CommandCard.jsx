import React from 'react';
import clsx from 'clsx';

/**
 * CommandCard — a quick-action tile in the Command Center.
 */
export default function CommandCard({ title, description, icon, accent = 'accent', onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'nova-card p-4 text-left flex flex-col gap-2 hover:border-nova-accent/50 transition-colors',
        disabled && 'opacity-60 cursor-not-allowed',
      )}
    >
      <div className={clsx(
        'w-9 h-9 rounded-lg flex items-center justify-center font-display text-base',
        accent === 'accent'  && 'bg-nova-accent/15 text-nova-accent border border-nova-accent/30',
        accent === 'accent2' && 'bg-nova-accent2/15 text-nova-accent2 border border-nova-accent2/30',
        accent === 'ok'      && 'bg-nova-ok/10 text-nova-ok border border-nova-ok/30',
      )}>
        {icon || '•'}
      </div>
      <div>
        <div className="font-display text-sm text-nova-text">{title}</div>
        {description && <div className="text-xs text-nova-muted mt-0.5">{description}</div>}
      </div>
    </button>
  );
}
