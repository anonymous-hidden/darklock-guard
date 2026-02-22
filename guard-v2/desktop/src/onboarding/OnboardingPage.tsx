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
import OnlineAuthStep from './OnlineAuthStep';
import OnlineLinkStep from './OnlineLinkStep';
import WelcomeStep from './WelcomeStep';
import TourStep from './TourStep';

/**
 * Step flow (hosted-only):
 *
 * online-auth → online-link → welcome → tour → /
 *
 * Mode-select and local-mode steps are removed: the backend is hosted on
 * darklock.net, so all users must create or sign in to an account.
 */

// Hosted-only flow: always online auth → server link → welcome → tour
const STEP_ORDER_ONLINE: OnboardingStep[] = [
  'online-auth',
  'online-link',
  'welcome',
  'tour',
];

function getStepOrder(_mode: 'local' | 'online' | null): OnboardingStep[] {
  return STEP_ORDER_ONLINE;
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
      case 'online-auth':
        return (
          <OnlineAuthStep
            state={state}
            onUpdate={update}
            onNext={goNext}
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

      case 'welcome':
        return (
          <WelcomeStep
            state={state}
            onStartTour={() => goTo('tour')}
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
