// React bindings for the device workspace state (session + picked project). Both are
// plain localStorage stores with pub/sub; useSyncExternalStore keeps components in step
// with login/logout and project switches (including from another tab).
import { useSyncExternalStore } from 'react';
import type { PublicUser } from '@fieldreport/contracts';
import { getAccount, getSessionToken, subscribeSession } from '../lib/session';
import { getActiveProject, subscribeActiveProject, type ActiveProject } from '../lib/activeProject';

export function useSessionToken(): string | null {
  return useSyncExternalStore(subscribeSession, getSessionToken);
}

// getAccount parses JSON (fresh object each call), which useSyncExternalStore would see
// as an endless change — cache the snapshot and refresh it only on emit.
let accountSnapshot: PublicUser | null = getAccount();
const subscribeAccountSnapshot = (fn: () => void) =>
  subscribeSession(() => {
    accountSnapshot = getAccount();
    fn();
  });

/** The cached signed-in account, reactively (login/logout/me-refresh, incl. cross-tab). */
export function useAccount(): PublicUser | null {
  return useSyncExternalStore(subscribeAccountSnapshot, () => accountSnapshot);
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
