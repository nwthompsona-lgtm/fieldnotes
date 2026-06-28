# FieldReport — Monitoring & the improvement flywheel

How we observe quality, reliability, and cost, and how production usage feeds back into a
better product. Three layers; only the **LLM-observability** layer is wired today (the other
two are deferred and noted at the bottom).

```
Layer 1  LLM observability + quality  → LangSmith        ✅ wired (this doc)
Layer 2  Product analytics (funnel)   → PostHog/etc.     ⏳ deferred (needs a client SDK)
Layer 3  Errors + uptime              → Sentry + monitor ⏳ deferred
```

---

## What's wired now (Layer 1)

Every report is a single LangSmith trace in project **`fieldreport`**:

```
fieldreport.report                      (root run; metadata below)
├─ transcribe              (tool)        — per clip; input/output + confidence
├─ fieldreport.synthesize  (chain)
│   └─ anthropic.synthesize (llm)        — system prompt, messages, token usage, cost
└─ render                  (tool)
```

**Root-run metadata** (for slicing): `reportId`, `projectId`, `projectName`,
`observationCount`, `model`, `sttModel`, `env`, `commit`.

**The AI draft is snapshotted at synthesis** (`reports.ai_summary`,
`observations.ai_cleaned_description`) and never touched by edits. Comparing it to the final,
edited text is how we measure quality automatically — no human labeling required.

### Feedback attached to each run

| Key | When | Meaning |
|---|---|---|
| `avg_transcript_confidence` | end of pipeline | mean Deepgram confidence over the walk (0–1) |
| `sent_unmodified` | on finalize | 1 if the super sent it with **zero** observation edits, else 0 |
| `obs_edit_distance` | on finalize | mean normalized token edit distance, AI draft → sent (0 = untouched, 1 = rewritten) |
| `summary_edit_distance` | on finalize | same, for the summary (noisier — the resummarize feature can change it) |

Feedback is best-effort and never blocks a request. A report processed *before* tracing was
enabled has no `langsmith_run_id`, so it simply gets no feedback.

### Admin metrics rollup

`GET /api/admin/metrics` (Bearer admin token) returns the aggregate, computed from the DB
(no LangSmith dependency):

```jsonc
{
  "totalReports", "byProcessing", "byStatus",
  "successRate",              // ready / total
  "reviewedCount", "measurableReviewedCount",
  "sentUnmodifiedRate",      // of reviewed reports w/ a snapshot, fraction sent untouched
  "avgObsEditDistance",      // mean edit burden on reviewed reports
  "avgTranscriptConfidence",
  "lowConfidenceObsRate"     // fraction of clips below 0.6
}
```

---

## KPIs and where to read them

| KPI | Source | Target / watch |
|---|---|---|
| **% sent unmodified** (north-star quality) | `sentUnmodifiedRate` / `sent_unmodified` | trend up |
| **Avg edit burden** | `avgObsEditDistance` / `obs_edit_distance` | trend down |
| **Report success rate** | `successRate` / `byProcessing` | > 99% |
| **Transcription quality** | `avgTranscriptConfidence`, `lowConfidenceObsRate` | low-confidence rate down |
| **Latency p50/p95** (upload→ready, per stage) | LangSmith run durations | watch p95 |
| **Cost per report** | LangSmith (token usage × `ls_model_name`) | watch per *sent* report |
| Reports sent / super / week, activation, retention | **Layer 2 (deferred)** | — |

---

## LangSmith dashboard setup (click-ops — do these in the UI)

1. **Monitoring charts** (project → Monitor): add charts for run count, error rate, p50/p95
   latency, total cost, and feedback averages (`sent_unmodified`, `obs_edit_distance`,
   `avg_transcript_confidence`). Group by `metadata.commit` to spot regressions per deploy.
2. **Online evaluators** (project → Evaluators → + Online): add LLM-as-judge evaluators that
   run on every prod `fieldreport.synthesize` run:
   - **Faithfulness** — "Does the output invent facts not supported by the transcript?"
   - **Completeness** — "Is every observation represented in the report?"
   - **Safety-flag** — "If a hazard is described in the transcript, is it captured?"
3. **Alerts** (project → Alerts): error-rate spike, p95 latency over threshold, and a drop in
   `avg_transcript_confidence` (early signal of an STT/lexicon regression).

---

## Offline eval (the regression gate)

Production edits are training data. The flow:

1. Build/refresh a golden dataset from real edited reports:
   ```bash
   BASE=https://fieldnotes-yglr.onrender.com \
   ADMIN_TOKEN=<admin token> \
   LANGSMITH_API_KEY=<lsv2_…> \
   node apps/server/scripts/eval-build-dataset.mjs
   ```
   This pulls reviewed reports and writes `{ transcript } → { cleanedDescription }` examples
   (the human-corrected version is the reference) into the LangSmith dataset
   **`fieldreport-synthesis`**.
2. In LangSmith, run the synthesis prompt against that dataset as an **Experiment** before
   shipping any prompt/model/lexicon change. Compare faithfulness + edit-distance vs the prior
   version; only ship if it doesn't regress.

This is what turns "the AI got it wrong" into a permanent test case.

---

## Deferred layers (need your accounts — not wired)

- **Layer 2 — Product analytics (PostHog).** Install/first-walk/capture/activation/retention
  happen in the PWA before the server sees anything, so they require a client-side SDK. When
  ready: add `posthog-js` to `apps/capture` + `apps/web` behind `VITE_POSTHOG_KEY` (no-op
  until set), instrument the funnel `install → walk → capture → sync → review → sent`.
- **Layer 3 — Errors + uptime.** Sentry (client + server) behind a DSN env var; an uptime
  monitor on `/healthz`.
- **Admin metrics panel.** `/api/admin/metrics` is live; a small dashboard card in the web
  admin is the obvious next step.
