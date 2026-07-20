import type { AvailableUpdate, UpdateSnapshot } from './updateStore';

export type UpdatePresentation = 'none' | 'routine-staged' | 'major-ready' | 'mandatory' | 'major-installed';

export function getUpdatePresentation(snapshot: UpdateSnapshot, pendingMajorNotes: AvailableUpdate | null): UpdatePresentation {
  if (pendingMajorNotes) return 'major-installed';
  const update = snapshot.available;
  if (!update) return 'none';
  if (snapshot.phase === 'blocked' && update.mandatory) return 'mandatory';
  if (update.classification === 'major' && ['staged', 'restart_required', 'deferred'].includes(snapshot.phase)) return 'major-ready';
  if (update.classification !== 'major' && !update.mandatory && snapshot.phase === 'staged') return 'routine-staged';
  return 'none';
}
