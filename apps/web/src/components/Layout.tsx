import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** App chrome: green header with brand + nav, then the routed page below. */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden />
            FieldReport
          </Link>
          <nav>
            <Link to="/">Home</Link>
            <Link to="/admin">Admin</Link>
          </nav>
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
