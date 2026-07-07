// React bindings for the device workspace state (session + picked project). Both are
// plain localStorage stores with pub/sub; useSyncExternalStore keeps components in step
// with login/logout and project switches (including from another tab).
import { useSyncExternalStore } from 'react';
import { getSessionToken, subscribeSession } from '../lib/session';
import { getActiveProject, subscribeActiveProject, type ActiveProject } from '../lib/activeProject';

export function useSessionToken(): string | null {
  return useSyncExternalStore(subscribeSession, getSessionToken);
}

// getActiveProject parses JSON (fresh object each call), which useSyncExternalStore
// would see as an endless change — cache the snapshot and refresh it only on emit.
let projectSnapshot: ActiveProject | null = getActiveProject();
const subscribeProjectSnapshot = (fn: () => void) =>
  subscribeActiveProject(() => {
    projectSnapshot = getActiveProject();
    fn();
  });

export function useActiveProject(): ActiveProject | null {
  return useSyncExternalStore(subscribeProjectSnapshot, () => projectSnapshot);
}
