// Build/refresh the offline-eval golden dataset from PRODUCTION edits — the flywheel seed.
//
// Pulls reviewed (human-approved) reports from the admin API and writes
//   { transcript, projectName, date }  ->  { cleanedDescription }
// examples into a LangSmith dataset. The human-approved description is the reference, so the
// dataset captures exactly the corrections supers made. Run before changing the synthesis
// prompt / model / lexicon, then run an Experiment in the LangSmith UI against this dataset.
//
// MANUAL TOOL — needs live keys, not run in CI/tests:
//   BASE=https://fieldnotes-yglr.onrender.com \
//   ADMIN_TOKEN=<admin token> \
//   LANGSMITH_API_KEY=<lsv2_…> \
//   [DATASET_NAME=fieldreport-synthesis] \
//   node apps/server/scripts/eval-build-dataset.mjs
//
// Note: re-running appends examples. For a clean rebuild, use a new DATASET_NAME or clear the
// dataset in the LangSmith UI first.
import { Client } from 'langsmith';

const BASE = process.env.BASE || 'https://fieldnotes-yglr.onrender.com';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DATASET = process.env.DATASET_NAME || 'fieldreport-synthesis';

if (!ADMIN_TOKEN) {
  console.error('ADMIN_TOKEN is required (Bearer token for /api/admin/*).');
  process.exit(1);
}
if (!process.env.LANGSMITH_API_KEY) {
  console.error('LANGSMITH_API_KEY is required.');
  process.exit(1);
}

const res = await fetch(`${BASE}/api/admin/reports`, {
  headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
});
if (!res.ok) {
  console.error(`admin reports fetch failed: HTTP ${res.status}`);
  process.exit(1);
}
const reports = await res.json();
const reviewed = reports.filter((r) => r.status === 'reviewed');

const examples = [];
for (const r of reviewed) {
  for (const o of r.observations ?? []) {
    const transcript = (o.transcript ?? '').trim();
    const cleaned = (o.cleanedDescription ?? '').trim();
    if (transcript && cleaned) {
      examples.push({
        inputs: { transcript, projectName: r.projectName ?? '', date: r.date },
        outputs: { cleanedDescription: cleaned },
        metadata: { reportId: r.id, observationId: o.id },
      });
    }
  }
}

console.log(`collected ${examples.length} examples from ${reviewed.length} reviewed reports`);
if (!examples.length) {
  console.log('nothing to write — no reviewed reports with transcript + description yet.');
  process.exit(0);
}

const client = new Client();
try {
  await client.createDataset(DATASET, {
    description: 'Transcript → human-approved description, harvested from reviewed reports.',
  });
  console.log(`created dataset "${DATASET}"`);
} catch {
  console.log(`dataset "${DATASET}" already exists — appending`);
}

let written = 0;
for (const ex of examples) {
  try {
    await client.createExample(ex.inputs, ex.outputs, { datasetName: DATASET, metadata: ex.metadata });
    written++;
  } catch (err) {
    console.error(`  skipped one example: ${err?.message ?? err}`);
  }
}
console.log(`wrote ${written}/${examples.length} examples to LangSmith dataset "${DATASET}"`);
process.exit(0);
