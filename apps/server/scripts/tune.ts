/**
 * Synthesis prompt-tuning harness (spec §13). Feeds the curated jobsite transcript corpus
 * (mock-corpus.ts — realistic narration incl. the prepped-vs-poured / proper-noun / garbled
 * edge cases) straight into the REAL synthesizer, bypassing STT/audio/DB/render so the IP
 * prompt can be iterated quickly against known-hard inputs.
 *
 *   npm run tune -w @fieldreport/server     # uses Claude when ANTHROPIC_API_KEY is set, else mock
 *
 * Prints, per observation, the input transcript next to the model's cleanedDescription +
 * trade/area, plus the daily summary — so quality and fidelity are easy to eyeball.
 */
import { config } from '../src/config.js';
import { makeSynthesizer } from '../src/synthesis/index.js';
import { MOCK_TRANSCRIPTS } from '../src/mock-corpus.js';
import { PILOT_GLOSSARY } from '../src/pilot.js';
import type { SynthesisInput } from '../src/synthesis/types.js';

const synth = makeSynthesizer(config);

const input: SynthesisInput = {
  project: {
    name: config.pilot.projectName,
    superName: config.pilot.superName,
    date: '2026-06-27',
    glossary: PILOT_GLOSSARY,
  },
  observations: MOCK_TRANSCRIPTS.map((t, i) => ({
    id: `obs-${i}`,
    order: i,
    transcript: t,
    photoCount: i % 3 === 0 ? 2 : 1,
  })),
};

console.log(`[tune] provider=${synth.name} model=${config.synthesis.model} · ${input.observations.length} observations\n`);
const t0 = Date.now();
const out = await synth.synthesize(input);
const ms = Date.now() - t0;

console.log('━━━ DAILY SUMMARY ━━━');
console.log(out.summary, '\n');

const byId = new Map(out.observations.map((o) => [o.id, o]));
for (const o of input.observations) {
  const r = byId.get(o.id);
  const tags = [r?.trade, r?.area].filter(Boolean).join(' · ');
  console.log(`#${o.order + 1}${tags ? `  [${tags}]` : ''}`);
  console.log(`  IN : ${o.transcript}`);
  console.log(`  OUT: ${r?.cleanedDescription ?? '(missing)'}\n`);
}
console.log(`[tune] done in ${ms}ms`);
process.exit(0);
