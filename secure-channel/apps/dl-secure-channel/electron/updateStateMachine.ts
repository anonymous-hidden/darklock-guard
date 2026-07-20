import type { UpdatePhase } from './updateTypes.js';

const ALLOWED_TRANSITIONS: Readonly<Record<UpdatePhase, readonly UpdatePhase[]>> = {
  idle: ['checking', 'completed'],
  checking: ['update_available', 'no_update', 'failed', 'blocked'],
  update_available: ['downloading', 'deferred', 'failed', 'blocked'],
  downloading: ['verifying', 'failed'],
  verifying: ['staged', 'failed', 'blocked'],
  staged: ['restart_required', 'installing', 'checking'],
  restart_required: ['installing', 'deferred', 'checking'],
  installing: ['completed', 'failed'],
  completed: ['checking', 'idle'],
  no_update: ['checking', 'idle'],
  deferred: ['checking', 'restart_required', 'installing'],
  failed: ['checking', 'idle'],
  blocked: ['checking', 'installing'],
};

export function canTransitionUpdateState(from: UpdatePhase, to: UpdatePhase): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}
