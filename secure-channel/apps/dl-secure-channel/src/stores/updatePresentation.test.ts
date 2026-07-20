import { describe, expect, it } from 'vitest';
import { getUpdatePresentation } from './updatePresentation';
import type { AvailableUpdate, UpdateSnapshot } from './updateStore';

const update: AvailableUpdate = {
  version: '3.0.0', channel: 'stable', classification: 'major', urgency: 'recommended', mandatory: false,
  publishedAt: '2026-07-14T00:00:00Z',
  releaseNotes: { title: 'Ridgeline 3', summary: 'Major', highlights: [], fixes: [], security: [] },
};
const snapshot = (patch: Partial<UpdateSnapshot>): UpdateSnapshot => ({
  phase: 'idle', currentVersion: '2.0.0', channel: 'stable', lastCheckedAt: null, available: null,
  progressPercent: null, bytesPerSecond: null, errorCode: null, restartBlockedReason: null, ...patch,
});

describe('update presentation policy', () => {
  it('keeps routine staged updates compact', () => {
    expect(getUpdatePresentation(snapshot({ phase: 'staged', available: { ...update, version: '2.0.1', classification: 'patch' } }), null)).toBe('routine-staged');
  });
  it('shows major restart and one-time post-install presentations', () => {
    expect(getUpdatePresentation(snapshot({ phase: 'restart_required', available: update }), null)).toBe('major-ready');
    expect(getUpdatePresentation(snapshot({ phase: 'completed', available: update }), update)).toBe('major-installed');
  });
  it('does not treat a routine update as a major announcement', () => {
    expect(getUpdatePresentation(snapshot({ phase: 'staged', available: { ...update, classification: 'minor' } }), null)).not.toBe('major-ready');
  });
  it('derives mandatory presentation only from the trusted snapshot', () => {
    const required = { ...update, classification: 'security' as const, urgency: 'required' as const, mandatory: true };
    expect(getUpdatePresentation(snapshot({ phase: 'blocked', available: required }), null)).toBe('mandatory');
    expect(getUpdatePresentation(snapshot({ phase: 'deferred', available: required }), null)).toBe('none');
  });
});
