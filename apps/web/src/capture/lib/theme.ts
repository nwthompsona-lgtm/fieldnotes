// One app, one theme store (Phase 13a): the capture flow re-exports the web app's
// theme module — same `fieldreport.theme` key and `data-theme` attribute both apps
// already used, so the Daylight/Nightshift toggle is shared across every surface.
export * from '../../lib/theme';
