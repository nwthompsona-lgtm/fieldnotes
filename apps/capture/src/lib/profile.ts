// Per-device, remembered report details (spec: the app should ask who prepared the
// report and which project it's for — and remember both so the user doesn't retype).
// Stored in localStorage (survives app close). The preparer name persists as a single
// value (pre-filled, editable); project labels accrue as a most-recent-first list that
// powers the project autocomplete.

const NAME_KEY = 'fieldreport.preparer';
const PROJECTS_KEY = 'fieldreport.projects';
const MAX_PROJECTS = 12;

/** The name of whoever prepares reports on this device (super, foreman, PM, …). */
export function getPreparerName(): string {
  try {
    return localStorage.getItem(NAME_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function setPreparerName(name: string): void {
  try {
    const v = name.trim();
    if (v) localStorage.setItem(NAME_KEY, v);
    else localStorage.removeItem(NAME_KEY);
  } catch {
    // localStorage unavailable — non-fatal; the field still works for this session.
  }
}

/** Project labels used before, most-recent first — drives the project autocomplete. */
export function getRecentProjects(): string[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** Remember a project label (case-insensitive de-dupe, newest first). */
export function recordProject(name: string): void {
  const v = name.trim();
  if (!v) return;
  try {
    const list = getRecentProjects().filter((p) => p.toLowerCase() !== v.toLowerCase());
    list.unshift(v);
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(list.slice(0, MAX_PROJECTS)));
  } catch {
    // non-fatal — autocomplete just won't remember this entry.
  }
}

/** FNV-1a → base36. Stable, dependency-free, short. Used only to disambiguate labels
 *  whose ASCII slug is empty (e.g. all-unicode names) so they don't collide. */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** Deterministic, stable project id from a label, so the SAME label always maps to the
 *  same server-side Project row (and its accumulating glossary). Re-typing or fixing the
 *  casing of a known project lands on the same id; two genuinely different labels don't.
 *  Non-ASCII/punctuation-only labels (whose ASCII slug is empty) fall back to a hash of the
 *  full label rather than a shared constant, so distinct unicode names get distinct ids. */
export function projectIdForName(name: string): string {
  const norm = name.trim().toLowerCase();
  const slug = norm
    .replace(/[^a-z0-9]+/g, '-') // any non-ascii (incl. accents) collapses to a separator
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, ''); // a 48-char cut can leave a trailing hyphen
  return slug ? `proj-${slug}` : `proj-${shortHash(norm) || 'untitled'}`;
}
