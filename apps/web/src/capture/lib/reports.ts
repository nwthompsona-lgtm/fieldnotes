// Lightweight record of reports this device has submitted, so the super can always get
// back to a report's review page (the link otherwise only appears once, right after Sync).
// Stored in localStorage (survives app close); capped to the most recent few.

const KEY = 'fieldreport.submitted';
const MAX = 10;

export interface SubmittedReport {
  id: string;
  at: string; // ISO timestamp
  count: number; // observations in the walk
}

export function getSubmittedReports(): SubmittedReport[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SubmittedReport[]) : [];
  } catch {
    return [];
  }
}

export function recordSubmittedReport(id: string, count: number): void {
  try {
    const list = getSubmittedReports().filter((r) => r.id !== id);
    list.unshift({ id, at: new Date().toISOString(), count });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // localStorage unavailable — non-fatal; the post-sync link still shows.
  }
}
