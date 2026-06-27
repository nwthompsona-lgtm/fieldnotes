import { useCallback, useState } from 'react';
import { ADMIN_TOKEN_KEY } from '../config';

/** Admin bearer token persisted in localStorage so the operator enters it once. */
export function useAdminToken() {
  const [token, setTokenState] = useState<string>(() => {
    try {
      return localStorage.getItem(ADMIN_TOKEN_KEY) ?? '';
    } catch {
      return '';
    }
  });

  const setToken = useCallback((next: string) => {
    setTokenState(next);
    try {
      if (next) localStorage.setItem(ADMIN_TOKEN_KEY, next);
      else localStorage.removeItem(ADMIN_TOKEN_KEY);
    } catch {
      // localStorage unavailable (private mode) — token still lives in memory.
    }
  }, []);

  const clear = useCallback(() => setToken(''), [setToken]);

  return { token, setToken, clear };
}
