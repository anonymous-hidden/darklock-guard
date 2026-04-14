import React from 'react';

const variants = {
  default: 'bg-[#404249] text-text-secondary',
  accent: 'bg-accent/20 text-accent',
  success: 'bg-success/20 text-success',
  danger: 'bg-danger/20 text-danger',
  warning: 'bg-warning/20 text-warning',
  online: 'bg-success/20 text-success',
  offline: 'bg-text-muted/20 text-text-muted'
};

export default function Badge({ children, variant = 'default', dot = false, count, className = '' }) {
  const variantClass = variants[variant] || variants.default;

  if (dot) {
    return (
      <span
        className={`inline-block w-2 h-2 rounded-full ${
          variant === 'accent' ? 'bg-accent' :
          variant === 'success' ? 'bg-success' :
          variant === 'danger' ? 'bg-danger' :
          variant === 'warning' ? 'bg-warning' : 'bg-text-muted'
        } ${className}`}
      />
    );
  }

  if (count !== undefined) {
    return (
      <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[11px] font-bold px-1 bg-danger text-white ${className}`}>
        {count > 99 ? '99+' : count}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded ${variantClass} ${className}`}>
      {children}
    </span>
  );
}
