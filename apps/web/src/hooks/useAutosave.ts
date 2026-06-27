import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReportEdit } from '@fieldreport/contracts';
import { AUTOSAVE_DEBOUNCE_MS } from '../config';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Debounced autosave for the review screen.
 *
 * Callers push partial ReportEdit patches via `queue(edit)`. Patches are MERGED
 * into a pending buffer (observations merged per-id) so several quick edits to
 * different fields collapse into one PATCH. After ~800ms of quiet the buffer is
 * flushed through `save`. The buffer is only cleared once the request resolves,
 * so a failed save never loses edits — `retry()` re-sends whatever is pending,
 * and any edits made during an in-flight save are coalesced and sent after it.
 */
export function useAutosave(save: (edit: ReportEdit) => Promise<unknown>) {
  const [state, setState] = useState<SaveState>('idle');

  const pending = useRef<ReportEdit>({});
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const hasPending = useCallback(() => {
    const p = pending.current;
    return p.summary !== undefined || (p.observations?.length ?? 0) > 0;
  }, []);

  const flush = useCallback(async () => {
    if (inFlight.current || !hasPending()) return;

    // Snapshot + clear the buffer up front; restore on failure so nothing is lost.
    const edit = pending.current;
    pending.current = {};
    inFlight.current = true;
    setState('saving');

    try {
      await saveRef.current(edit);
      inFlight.current = false;
      // Edits may have arrived while saving — flush them, else show "Saved".
      if (hasPending()) {
        void flush();
      } else {
        setState('saved');
      }
    } catch {
      // Merge the failed edit back UNDER any newer edits (newer wins per field).
      pending.current = mergeEdit(edit, pending.current);
      inFlight.current = false;
      setState('error');
    }
  }, [hasPending]);

  const queue = useCallback(
    (edit: ReportEdit) => {
      pending.current = mergeEdit(pending.current, edit);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), AUTOSAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  const retry = useCallback(() => void flush(), [flush]);

  // Guard against silently losing edits when the tab/page is torn down before a
  // debounced (or in-flight) save resolves. A bare unmount `flush()` is not enough:
  // if a save is in flight the flush early-returns, and a PATCH fired during page
  // teardown can be aborted by the browser. `beforeunload` lets the user abort the
  // navigation so the pending PATCH can still settle.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasPending() || inFlight.current) {
        // Try one last flush of debounced-but-not-yet-sent edits.
        if (timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
        }
        void flush();
        e.preventDefault();
        // Legacy browsers require a string return / assignment to trigger the prompt.
        e.returnValue = '';
        return '';
      }
      return undefined;
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flush, hasPending]);

  // Best-effort flush of pending edits on unmount (SPA navigation away from the page).
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void flush();
    };
  }, [flush]);

  return { state, queue, retry, hasPending };
}

/** Merge `next` onto `base` (next wins). Observations merge per id and per field. */
function mergeEdit(base: ReportEdit, next: ReportEdit): ReportEdit {
  const out: ReportEdit = {};

  if (next.summary !== undefined) out.summary = next.summary;
  else if (base.summary !== undefined) out.summary = base.summary;

  const byId = new Map<string, { id: string; cleanedDescription?: string; trade?: string; area?: string }>();
  for (const o of base.observations ?? []) byId.set(o.id, { ...o });
  for (const o of next.observations ?? []) {
    byId.set(o.id, { ...(byId.get(o.id) ?? { id: o.id }), ...o });
  }
  if (byId.size > 0) out.observations = [...byId.values()];

  return out;
}
