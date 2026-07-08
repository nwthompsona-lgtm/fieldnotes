import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth, RedirectIfAuthed } from './components/guards';
import { WorkspaceProvider } from './workspace';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { HomePage } from './pages/HomePage';
import { ReportsListPage } from './pages/ReportsListPage';
import { AccountPage } from './pages/AccountPage';
import { DeliveryPage } from './pages/DeliveryPage';
import { SettingsLayout } from './pages/settings/SettingsLayout';
import { MembersPage } from './pages/settings/MembersPage';
import { ProjectsPage } from './pages/settings/ProjectsPage';
import { StakeholdersPage } from './pages/settings/StakeholdersPage';
import { ReviewPage } from './pages/ReviewPage';
import { AdminListPage } from './pages/AdminListPage';
import { AdminDetailPage } from './pages/AdminDetailPage';
import { CaptureApp } from './capture/CaptureApp';

/** The capture flow (Phase 13a): full-screen mobile surface OUTSIDE the app shell —
 *  it carries its own install gate → login → project picker, works fully offline, and
 *  shares the session store, so finishing a walk hands off to /review with no second
 *  login. The `.cap` wrapper scopes capture.css (see postcss.config.cjs). */
function CaptureRoute() {
  return (
    <div className="cap">
      <CaptureApp />
    </div>
  );
}

/** Everything behind login lives inside the workspace-aware app shell. */
function Shell() {
  return (
    <RequireAuth>
      <WorkspaceProvider>
        <AppShell />
      </WorkspaceProvider>
    </RequireAuth>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Auth screens (no shell) */}
        <Route
          path="/login"
          element={
            <RedirectIfAuthed>
              <LoginPage />
            </RedirectIfAuthed>
          }
        />
        <Route
          path="/signup"
          element={
            <RedirectIfAuthed>
              <SignupPage />
            </RedirectIfAuthed>
          }
        />
        {/* Accept works logged-in or out (an existing user can gain a membership). */}
        <Route path="/accept" element={<AcceptInvitePage />} />

        {/* The capture flow — no RequireAuth wrapper: it gates itself (offline-first,
            cached-account boot; only a real 401 drops it to its login screen). */}
        <Route path="/capture" element={<CaptureRoute />} />

        {/* The app (auth + workspace + shell) */}
        <Route element={<Shell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/p/:projectId/reports" element={<ReportsListPage />} />
          <Route path="/review/:id" element={<ReviewPage />} />
          <Route path="/review/:id/delivery" element={<DeliveryPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="/settings/members" replace />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="stakeholders" element={<StakeholdersPage />} />
          </Route>
          <Route path="/admin" element={<AdminListPage />} />
          <Route path="/admin/:id" element={<AdminDetailPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
