/**
 * Darklock Guard — Onboarding Page Orchestrator
 *
 * Manages the complete first-run onboarding flow.
 * Renders the current step and handles navigation between steps.
 */

import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { OnboardingState, OnboardingStep } from './types';
import { INITIAL_STATE } from './types';
import { OnboardingShell } from './components';
import ModeSelectStep from './ModeSelectStep';
import LocalPasswordStep from './LocalPasswordStep';
import LocalConfigStep from './LocalConfigStep';
import OnlineAuthStep from './OnlineAuthStep';
import OnlineLinkStep from './OnlineLinkStep';
import InitializingStep from './InitializingStep';
import WelcomeStep from './WelcomeStep';
import TourStep from './TourStep';

/**
 * Step flow graph:
 *
 * mode-select ──┬── local-password → local-config → initializing → welcome → tour → /
 *               └── online-auth → online-link → welcome → tour → /
 *
 * OnlineLinkStep handles vault creation + device registration internally,
 * so it skips the initializing step and goes straight to welcome.
 */

const STEP_ORDER_LOCAL: OnboardingStep[] = [
  'mode-select',
  'local-password',
  'local-config',
  'initializing',
  'welcome',
  'tour',
];

const STEP_ORDER_ONLINE: OnboardingStep[] = [
  'mode-select',
  'online-auth',
  'online-link',
  'welcome',
  'tour',
];

function getStepOrder(mode: 'local' | 'online' | null): OnboardingStep[] {
  if (mode === 'online') return STEP_ORDER_ONLINE;
  return STEP_ORDER_LOCAL;
}

function nextStep(current: OnboardingStep, mode: 'local' | 'online' | null): OnboardingStep {
  const order = getStepOrder(mode);
  const idx = order.indexOf(current);
  return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : current;
}

function prevStep(current: OnboardingStep, mode: 'local' | 'online' | null): OnboardingStep {
  const order = getStepOrder(mode);
  const idx = order.indexOf(current);
  return idx > 0 ? order[idx - 1] : current;
}

const OnboardingPage: React.FC = () => {
  const navigate = useNavigate();
  const [state, setState] = useState<OnboardingState>(INITIAL_STATE);

  const update = useCallback((patch: Partial<OnboardingState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  // Use a ref to track mode synchronously so the onNext handler
  // in mode-select can read the latest value
  const modeRef = React.useRef(state.mode);
  React.useEffect(() => { modeRef.current = state.mode; }, [state.mode]);

  const goNext = useCallback(() => {
    setState((prev) => ({
      ...prev,
      step: nextStep(prev.step, prev.mode),
      error: null,
    }));
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => ({
      ...prev,
      step: prevStep(prev.step, prev.mode),
      error: null,
    }));
  }, []);

  const goTo = useCallback((step: OnboardingStep) => {
    setState((prev) => ({ ...prev, step, error: null }));
  }, []);

  const finish = useCallback(() => {
    // Mark onboarding complete by writing a flag to localStorage
    localStorage.setItem('darklock_onboarding_complete', 'true');
    navigate('/', { replace: true });
  }, [navigate]);

  const renderStep = () => {
    switch (state.step) {
      case 'mode-select':
        return (
          <ModeSelectStep
            state={state}
            onUpdate={update}
            onNext={() => {
              const mode = modeRef.current;
              if (mode === 'online') {
                goTo('online-auth');
              } else {
                goTo('local-password');
              }
            }}
          />
        );

      case 'local-password':
        return (
          <LocalPasswordStep
            state={state}
            onUpdate={update}
            onNext={goNext}
            onBack={() => goTo('mode-select')}
          />
        );

      case 'local-config':
        return (
          <LocalConfigStep
            state={state}
            onUpdate={update}
            onNext={goNext}
            onBack={goBack}
          />
        );

      case 'online-auth':
        return (
          <OnlineAuthStep
            state={state}
            onUpdate={update}
            onNext={goNext}
            onBack={() => goTo('mode-select')}
          />
        );

      case 'online-link':
        return (
          <OnlineLinkStep
            state={state}
            onUpdate={update}
            onNext={() => goTo('welcome')}
            onBack={goBack}
          />
        );

      case 'initializing':
        return (
          <InitializingStep
            state={state}
            onUpdate={update}
            onNext={() => goTo('welcome')}
          />
        );

      case 'welcome':
        return (
          <WelcomeStep
            state={state}
            onStartTour={() => goTo('tour')}
            onSkip={finish}
          />
        );

      case 'tour':
        return (
          <TourStep
            tourStep={state.tourStep}
            onSetStep={(idx) => update({ tourStep: idx })}
            onFinish={finish}
          />
        );

      default:
        return null;
    }
  };

  return (
    <OnboardingShell>
      {renderStep()}
    </OnboardingShell>
  );
};

export default OnboardingPage;
