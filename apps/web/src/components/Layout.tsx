import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';

/** The waypoint-pin logomark (two-tone), matching the capture app. */
function Pin({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 22c5-5.6 8-9.3 8-13a8 8 0 1 0-16 0c0 3.7 3 7.4 8 13Z" fill="var(--primary)" />
      <path d="M9 9.4v4.6M12 7.6v8.2M15 9.4v4.6" stroke="var(--primary-ink)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** App chrome: brand + nav + theme toggle, then the routed page below. */
export function Layout({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();
  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <Link to="/" className="brand">
            <span className="brand-mark">
              <Pin />
            </span>
            FieldReport
          </Link>
          <nav>
            <Link to="/">Home</Link>
            <Link to="/admin">Admin</Link>
            <button
              className="theme-toggle"
              onClick={toggle}
              aria-label={theme === 'dark' ? 'Switch to Daylight' : 'Switch to Nightshift'}
              type="button"
            >
              {theme === 'dark' ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20 14.5A8.2 8.2 0 0 1 9.4 4 7 7 0 1 0 20 14.5Z" />
                </svg>
              )}
            </button>
          </nav>
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
