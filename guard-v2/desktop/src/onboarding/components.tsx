/**
 * Darklock Guard — Shared Onboarding UI Components
 *
 * Reusable primitives for the onboarding flow.
 * All components follow the design system: dark charcoal + cyan accent.
 */

import React from 'react';
import { STRENGTH_COLORS, STRENGTH_LABELS } from './types';
import { getPasswordStrength } from './utils';

/* ------------------------------------------------------------------ */
/*  OnboardingShell                                                    */
/* ------------------------------------------------------------------ */

export const OnboardingShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center p-6 relative overflow-hidden">
    {/* Ambient glow */}
    <div className="absolute top-[-30%] left-[-10%] w-[600px] h-[600px] rounded-full bg-accent-primary/[0.04] blur-[120px] pointer-events-none" />
    <div className="absolute bottom-[-20%] right-[-5%] w-[500px] h-[500px] rounded-full bg-accent-secondary/[0.04] blur-[100px] pointer-events-none" />
    {children}
  </div>
);

/* ------------------------------------------------------------------ */
/*  OnboardingCard                                                     */
/* ------------------------------------------------------------------ */

export const OnboardingCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  wide?: boolean;
}> = ({ children, className = '', wide }) => (
  <div
    className={`
      relative w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'}
      bg-gradient-to-b from-bg-tertiary/80 to-bg-secondary/60
      border border-white/[0.06]
      rounded-2xl backdrop-blur-xl
      shadow-[0_32px_80px_rgba(0,0,0,0.5)]
      overflow-hidden
      animate-fadeIn
      ${className}
    `}
  >
    {/* Top accent line */}
    <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent-primary/40 to-transparent" />
    <div className="p-8 sm:p-10">{children}</div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  StepHeader                                                         */
/* ------------------------------------------------------------------ */

export const StepHeader: React.FC<{
  title: string;
  subtitle?: string;
  step?: { current: number; total: number };
}> = ({ title, subtitle, step }) => (
  <div className="mb-8">
    {step && (
      <div className="flex items-center gap-2 mb-5">
        <span className="text-[11px] font-medium text-text-muted uppercase tracking-[0.15em]">
          Step {step.current} of {step.total}
        </span>
        <div className="flex-1 h-px bg-white/[0.06]" />
      </div>
    )}
    <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
    {subtitle && <p className="text-sm text-text-secondary mt-2 leading-relaxed">{subtitle}</p>}
  </div>
);

/* ------------------------------------------------------------------ */
/*  ProgressBar                                                        */
/* ------------------------------------------------------------------ */

export const ProgressBar: React.FC<{
  steps: { key: string; label: string }[];
  currentKey: string;
}> = ({ steps, currentKey }) => {
  const currentIdx = steps.findIndex((s) => s.key === currentKey);
  return (
    <div className="flex items-center gap-1.5 mb-8">
      {steps.map((s, i) => (
        <React.Fragment key={s.key}>
          <div className="flex items-center gap-2">
            <div
              className={`
                w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold
                transition-all duration-300
                ${i < currentIdx
                  ? 'bg-accent-primary text-bg-primary'
                  : i === currentIdx
                    ? 'bg-accent-primary/20 text-accent-primary border border-accent-primary/40'
                    : 'bg-white/[0.04] text-text-muted border border-white/[0.06]'
                }
              `}
            >
              {i < currentIdx ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span className={`text-xs font-medium hidden sm:block ${i <= currentIdx ? 'text-text-primary' : 'text-text-muted'}`}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-px mx-1 transition-colors duration-300 ${i < currentIdx ? 'bg-accent-primary/40' : 'bg-white/[0.06]'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  PrimaryButton / GhostButton                                       */
/* ------------------------------------------------------------------ */

export const PrimaryButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }
> = ({ children, loading, disabled, className = '', ...props }) => (
  <button
    disabled={disabled || loading}
    className={`
      relative px-5 py-2.5 rounded-lg text-sm font-semibold
      flex items-center justify-center gap-2
      transition-all duration-200
      ${disabled || loading
        ? 'bg-white/[0.06] text-text-muted cursor-not-allowed'
        : 'bg-accent-primary text-bg-primary hover:brightness-110 active:scale-[0.98] shadow-glow'
      }
      ${className}
    `}
    {...props}
  >
    {loading && (
      <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
    )}
    {children}
  </button>
);

export const GhostButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement>
> = ({ children, className = '', ...props }) => (
  <button
    className={`
      px-4 py-2.5 rounded-lg text-sm font-medium
      text-text-secondary hover:text-text-primary hover:bg-white/[0.04]
      transition-all duration-200
      ${className}
    `}
    {...props}
  >
    {children}
  </button>
);

/* ------------------------------------------------------------------ */
/*  PasswordInput                                                      */
/* ------------------------------------------------------------------ */

export const PasswordInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  showStrength?: boolean;
  autoFocus?: boolean;
}> = ({ value, onChange, placeholder = 'Enter password', showStrength, autoFocus }) => {
  const [visible, setVisible] = React.useState(false);
  const strength = getPasswordStrength(value);

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          className="w-full bg-bg-primary/60 border border-white/[0.08] rounded-lg px-4 py-3 text-sm
                     placeholder:text-text-muted/60
                     focus:outline-none focus:border-accent-primary/40 focus:ring-1 focus:ring-accent-primary/20
                     transition-all duration-200"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          autoComplete="new-password"
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
          tabIndex={-1}
        >
          {visible ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          )}
        </button>
      </div>
      {showStrength && value.length > 0 && (
        <div>
          <div className="flex gap-1 mb-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                  i <= strength ? STRENGTH_COLORS[strength] : 'bg-white/[0.06]'
                }`}
              />
            ))}
          </div>
          <span className="text-[11px] text-text-muted">{STRENGTH_LABELS[strength]}</span>
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  TextInput                                                          */
/* ------------------------------------------------------------------ */

export const TextInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
}> = ({ value, onChange, placeholder, type = 'text', autoFocus }) => (
  <input
    type={type}
    className="w-full bg-bg-primary/60 border border-white/[0.08] rounded-lg px-4 py-3 text-sm
               placeholder:text-text-muted/60
               focus:outline-none focus:border-accent-primary/40 focus:ring-1 focus:ring-accent-primary/20
               transition-all duration-200"
    placeholder={placeholder}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    autoFocus={autoFocus}
  />
);

/* ------------------------------------------------------------------ */
/*  SelectCard                                                         */
/* ------------------------------------------------------------------ */

export const SelectCard: React.FC<{
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
  accentColor?: string;
}> = ({ selected, onClick, icon, title, description, badge, accentColor = 'accent-primary' }) => (
  <button
    onClick={onClick}
    className={`
      relative w-full p-6 rounded-xl border text-left
      transition-all duration-300 group
      ${selected
        ? `border-${accentColor}/40 bg-${accentColor}/[0.05] shadow-[0_0_30px_rgba(0,240,255,0.08)]`
        : 'border-white/[0.06] bg-white/[0.015] hover:border-white/[0.12] hover:bg-white/[0.03]'
      }
    `}
  >
    {/* Selected indicator */}
    {selected && (
      <div className={`absolute top-4 right-4 w-5 h-5 rounded-full bg-${accentColor} flex items-center justify-center`}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="text-bg-primary">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
    )}
    <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-colors duration-300 ${
      selected ? `bg-${accentColor}/15` : 'bg-white/[0.04] group-hover:bg-white/[0.06]'
    }`}>
      {icon}
    </div>
    <h3 className="text-base font-semibold mb-1.5">{title}</h3>
    <p className="text-sm text-text-secondary leading-relaxed">{description}</p>
    {badge && (
      <span className={`inline-block mt-3 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
        selected ? `bg-${accentColor}/20 text-${accentColor}` : 'bg-white/[0.04] text-text-muted'
      }`}>
        {badge}
      </span>
    )}
  </button>
);

/* ------------------------------------------------------------------ */
/*  ErrorBanner                                                        */
/* ------------------------------------------------------------------ */

export const ErrorBanner: React.FC<{ message: string; onDismiss?: () => void }> = ({ message, onDismiss }) => (
  <div className="flex items-start gap-3 p-4 rounded-lg bg-semantic-error/[0.08] border border-semantic-error/20 animate-fadeIn">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-semantic-error shrink-0 mt-0.5">
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
    <p className="text-sm text-semantic-error flex-1">{message}</p>
    {onDismiss && (
      <button onClick={onDismiss} className="text-semantic-error/60 hover:text-semantic-error transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    )}
  </div>
);

/* ------------------------------------------------------------------ */
/*  WarningNote                                                        */
/* ------------------------------------------------------------------ */

export const WarningNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-semantic-warning/[0.06] border border-semantic-warning/15">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-semantic-warning shrink-0 mt-0.5">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
    <p className="text-xs text-text-secondary leading-relaxed">{children}</p>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Toggle                                                             */
/* ------------------------------------------------------------------ */

export const Toggle: React.FC<{
  enabled: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}> = ({ enabled, onChange, label, description }) => (
  <div className="flex items-center justify-between py-3">
    <div>
      <p className="text-sm font-medium">{label}</p>
      {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
    </div>
    <button
      onClick={() => onChange(!enabled)}
      className={`relative w-11 h-6 rounded-full transition-all duration-200 cursor-pointer ${
        enabled ? 'bg-accent-primary' : 'bg-white/[0.08] border border-white/[0.1]'
      }`}
    >
      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200 ${
        enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
      }`} />
    </button>
  </div>
);
