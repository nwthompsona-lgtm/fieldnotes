/**
 * Route guards. RequireAuth sends logged-out visitors to /login (remembering where they
 * were headed); RedirectIfAuthed keeps logged-in users off the auth screens. Both react
 * live to the session store, so a 401-triggered clearSession() lands on /login without a
 * reload.
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSessionToken } from '../hooks/useSession';

export function RequireAuth({ children }: { children: ReactNode }) {
  const token = useSessionToken();
  const location = useLocation();
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}

export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const token = useSessionToken();
  if (token) return <Navigate to="/" replace />;
  return <>{children}</>;
}
