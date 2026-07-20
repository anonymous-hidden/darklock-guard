import { describe, expect, it } from 'vitest';
import { canTransitionUpdateState } from './updateStateMachine';

describe('updater state machine', () => {
  it('supports the verified download and install path', () => {
    expect(canTransitionUpdateState('idle', 'checking')).toBe(true);
    expect(canTransitionUpdateState('checking', 'update_available')).toBe(true);
    expect(canTransitionUpdateState('update_available', 'downloading')).toBe(true);
    expect(canTransitionUpdateState('downloading', 'verifying')).toBe(true);
    expect(canTransitionUpdateState('verifying', 'staged')).toBe(true);
    expect(canTransitionUpdateState('staged', 'restart_required')).toBe(true);
    expect(canTransitionUpdateState('restart_required', 'installing')).toBe(true);
    expect(canTransitionUpdateState('installing', 'completed')).toBe(true);
  });

  it('allows retry and deferral without allowing verification bypasses', () => {
    expect(canTransitionUpdateState('failed', 'checking')).toBe(true);
    expect(canTransitionUpdateState('restart_required', 'deferred')).toBe(true);
    expect(canTransitionUpdateState('update_available', 'staged')).toBe(false);
    expect(canTransitionUpdateState('downloading', 'installing')).toBe(false);
    expect(canTransitionUpdateState('verifying', 'installing')).toBe(false);
    expect(canTransitionUpdateState('blocked', 'deferred')).toBe(false);
  });
});
