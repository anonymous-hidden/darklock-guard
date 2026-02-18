/**
 * Darklock Guard — Onboarding Type Definitions
 *
 * Central type definitions for the first-run onboarding flow.
 * All onboarding state is typed here to enforce compile-time correctness.
 */

export type OnboardingStep =
  | 'mode-select'
  | 'local-password'
  | 'local-config'
  | 'online-auth'
  | 'online-link'
  | 'initializing'
  | 'welcome'
  | 'tour';

export type OperationMode = 'local' | 'online';
export type SecurityProfile = 'standard' | 'zerotrust';
export type AuthTab = 'login' | 'register';

export interface OnboardingState {
  step: OnboardingStep;
  mode: OperationMode | null;
  password: string;
  confirmPassword: string;
  securityProfile: SecurityProfile;
  manualUpdateNotifications: boolean;
  // Online mode state
  authTab: AuthTab;
  email: string;
  username: string;
  authPassword: string;
  authConfirmPassword: string;
  sessionToken: string | null;
  deviceId: string | null;
  linkCode: string;
  // Vault creation
  vaultCreated: boolean;
  initProgress: number;
  initStage: string;
  // Errors
  error: string | null;
  loading: boolean;
  // Tour
  tourStep: number;
}

export const INITIAL_STATE: OnboardingState = {
  step: 'mode-select',
  mode: null,
  password: '',
  confirmPassword: '',
  securityProfile: 'standard',
  manualUpdateNotifications: true,
  authTab: 'login',
  email: '',
  username: '',
  authPassword: '',
  authConfirmPassword: '',
  sessionToken: null,
  deviceId: null,
  linkCode: '',
  vaultCreated: false,
  initProgress: 0,
  initStage: '',
  error: null,
  loading: false,
  tourStep: 0,
};

export interface TourItem {
  title: string;
  description: string;
  icon: string;
  highlight: string;
}

export const TOUR_ITEMS: TourItem[] = [
  {
    title: 'Dashboard',
    description: 'Your security command center. Monitor protection status, connection state, and recent events at a glance.',
    icon: 'status',
    highlight: '/',
  },
  {
    title: 'Protection',
    description: 'Configure real-time file monitoring, manage protected directories, and choose your security profile.',
    icon: 'protection',
    highlight: '/protection',
  },
  {
    title: 'Integrity Scans',
    description: 'Run quick, full, or custom scans to verify file integrity against your signed baseline.',
    icon: 'scans',
    highlight: '/scans',
  },
  {
    title: 'Event Log',
    description: 'Tamper-proof, hash-chained audit log. Every security event is signed and verifiable.',
    icon: 'events',
    highlight: '/events',
  },
  {
    title: 'Updates',
    description: 'Manage software updates with signed releases. Rollback support included.',
    icon: 'updates',
    highlight: '/updates',
  },
  {
    title: 'Settings',
    description: 'Fine-tune performance limits, privacy controls, and advanced configuration.',
    icon: 'settings',
    highlight: '/settings',
  },
];

/** Password strength levels */
export const STRENGTH_LABELS = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'] as const;
export const STRENGTH_COLORS = [
  'bg-red-500',
  'bg-orange-500',
  'bg-yellow-500',
  'bg-blue-400',
  'bg-emerald-500',
] as const;
