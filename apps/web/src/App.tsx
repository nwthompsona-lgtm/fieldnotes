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
import { SettingsPlaceholderPage } from './pages/SettingsPlaceholderPage';
import { ReviewPage } from './pages/ReviewPage';
import { AdminListPage } from './pages/AdminListPage';
import { AdminDetailPage } from './pages/AdminDetailPage';

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

        {/* The app (auth + workspace + shell) */}
        <Route element={<Shell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/p/:projectId/reports" element={<ReportsListPage />} />
          <Route path="/review/:id" element={<ReviewPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/settings/*" element={<SettingsPlaceholderPage />} />
          <Route path="/admin" element={<AdminListPage />} />
          <Route path="/admin/:id" element={<AdminDetailPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
