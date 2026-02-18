/**
 * Step 6 — Guided Tour
 *
 * Walk the user through the main areas of Darklock Guard.
 * Each slide shows an icon, title, and description.
 * Navigation: Next / Back / Skip.
 */

import React from 'react';
import { TOUR_ITEMS } from './types';
import { OnboardingCard, PrimaryButton, GhostButton } from './components';

interface Props {
  tourStep: number;
  onSetStep: (idx: number) => void;
  onFinish: () => void;
}

/** Icon map keyed by TourItem.icon */
const ICONS: Record<string, React.ReactNode> = {
  status: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  protection: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  scans: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  events: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  updates: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="2" x2="12" y2="16" /><polyline points="16 12 12 16 8 12" />
      <path d="M20 21H4" />
    </svg>
  ),
  settings: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

const TourStep: React.FC<Props> = ({ tourStep, onSetStep, onFinish }) => {
  const item = TOUR_ITEMS[tourStep];
  const isLast = tourStep === TOUR_ITEMS.length - 1;
  const isFirst = tourStep === 0;

  return (
    <OnboardingCard>
      <div className="text-center py-4">
        {/* Step dots */}
        <div className="flex items-center justify-center gap-1.5 mb-8">
          {TOUR_ITEMS.map((_, i) => (
            <button
              key={i}
              onClick={() => onSetStep(i)}
              className={`
                h-1.5 rounded-full transition-all duration-300 cursor-pointer
                ${i === tourStep
                  ? 'w-8 bg-accent-primary'
                  : i < tourStep
                    ? 'w-1.5 bg-accent-primary/40'
                    : 'w-1.5 bg-white/[0.08]'
                }
              `}
            />
          ))}
        </div>

        {/* Icon */}
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center text-accent-primary">
          {ICONS[item.icon] ?? ICONS.status}
        </div>

        <h2 className="text-xl font-bold mb-2">{item.title}</h2>
        <p className="text-sm text-text-secondary max-w-md mx-auto leading-relaxed mb-8">
          {item.description}
        </p>

        {/* Navigation hint */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <span className="text-[11px] text-text-muted">Navigate to:&nbsp;</span>
          <code className="text-[11px] font-mono text-accent-primary bg-accent-primary/10 px-2 py-1 rounded">
            {item.highlight}
          </code>
        </div>

        <div className="flex justify-between items-center">
          <GhostButton onClick={onFinish}>Skip Tour</GhostButton>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <GhostButton onClick={() => onSetStep(tourStep - 1)}>Back</GhostButton>
            )}
            {isLast ? (
              <PrimaryButton onClick={onFinish}>
                Go to Dashboard
              </PrimaryButton>
            ) : (
              <PrimaryButton onClick={() => onSetStep(tourStep + 1)}>
                Next
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </PrimaryButton>
            )}
          </div>
        </div>
      </div>
    </OnboardingCard>
  );
};

export default TourStep;
