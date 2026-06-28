/**
 * LangSmith feedback sink. Closes the loop on a trace: after a report is processed and
 * reviewed, we attach outcome scores (transcription confidence, how much the super edited
 * the AI draft, sent-unmodified) to its root run so quality is queryable in LangSmith and
 * can seed offline eval datasets. All best-effort — observability must never break a request.
 */
import { Client } from 'langsmith';

let cached: Client | null = null;

function client(): Client {
  // Reads LANGSMITH_API_KEY / endpoint from env (the same vars that gate tracing).
  return (cached ??= new Client());
}

/**
 * Attach numeric feedback scores to a run, keyed by metric name. No-op when tracing is off
 * or the run id is unknown (e.g. a report processed before tracing was enabled). Never throws.
 */
export async function recordRunFeedback(
  enabled: boolean,
  runId: string | null | undefined,
  scores: Record<string, number | null | undefined>,
): Promise<void> {
  if (!enabled || !runId) return;
  const c = client();
  await Promise.all(
    Object.entries(scores)
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
      .map(([key, score]) =>
        c.createFeedback(runId, key, { score }).catch(() => {
          /* best-effort: a failed feedback write must not affect the request */
        }),
      ),
  );
}
