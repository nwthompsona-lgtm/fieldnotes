/** React binding for the session store: re-renders on login/logout (incl. cross-tab). */
import { useSyncExternalStore } from 'react';
import { getSessionToken, subscribeSession } from '../session';

export function useSessionToken(): string | null {
  return useSyncExternalStore(subscribeSession, getSessionToken);
}
