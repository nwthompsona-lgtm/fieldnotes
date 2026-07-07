/**
 * Placeholder for /settings/* until the F2 phase lands Members & roles, Projects, and the
 * Stakeholder directory. Linked from the user menu (admins/PMs) so the shell's nav shape
 * matches the design now; the real screens replace this file in Phase 10.
 */
export function SettingsPlaceholderPage() {
  return (
    <div className="page page-narrow">
      <p className="eyebrow">Settings</p>
      <div className="empty">
        <h2>Members &amp; settings are almost here</h2>
        <p>
          Managing members, project visibility, and the stakeholder directory arrives in
          the next update.
        </p>
      </div>
    </div>
  );
}
