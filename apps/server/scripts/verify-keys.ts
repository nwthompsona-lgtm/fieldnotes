/**
 * Verify each configured provider actually works (not just that a key is present).
 * Prints provider names + pass/fail ONLY — never secret values. `npm run verify:keys`.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@deepgram/sdk';
import { config } from '../src/config.js';
import { getDb, ensureSchema, makeRepo } from '../src/db/index.js';
import { makeStorage } from '../src/storage/index.js';

type Row = { name: string; ok: boolean; detail: string };
const rows: Row[] = [];
const ok = (name: string, detail: string) => {
  rows.push({ name, ok: true, detail });
  console.log(`  ✅ ${name}: ${detail}`);
};
const fail = (name: string, e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  rows.push({ name, ok: false, detail: msg });
  console.log(`  ❌ ${name}: ${msg}`);
};

console.log('Verifying providers (no secrets printed)…\n');

// 1. Anthropic
try {
  if (config.synthesis.provider !== 'claude') throw new Error('ANTHROPIC_API_KEY not set (mock mode)');
  const client = new Anthropic({ apiKey: config.synthesis.anthropicApiKey });
  const r = await client.messages.create({
    model: config.synthesis.model,
    max_tokens: 16,
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
  });
  const text = r.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
  ok('Anthropic', `model "${config.synthesis.model}" responded ("${text.slice(0, 24)}")`);
} catch (e) {
  fail('Anthropic', e);
}

// 2. Deepgram — transcribe their official sample clip end to end
try {
  if (config.stt.provider !== 'deepgram') throw new Error('DEEPGRAM_API_KEY not set (mock mode)');
  const dg = createClient(config.stt.deepgramApiKey!);
  const { result, error } = await dg.listen.prerecorded.transcribeUrl(
    { url: 'https://dpgr.am/spacewalk.wav' },
    { model: config.stt.model, smart_format: true, punctuate: true },
  );
  if (error) throw new Error((error as { message?: string }).message ?? String(error));
  const t = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
  if (!t) throw new Error('empty transcript');
  ok('Deepgram', `model "${config.stt.model}" transcribed sample ("${t.slice(0, 40)}…")`);
} catch (e) {
  fail('Deepgram', e);
}

// 3. Database — connect + ensure schema + seed pilot
try {
  const db = await getDb(config);
  await ensureSchema(db);
  const repo = makeRepo(db);
  await repo.upsertProject({
    id: config.pilot.projectId,
    name: config.pilot.projectName,
    superName: config.pilot.superName,
    glossary: [],
    baseLexiconRef: 'base-construction-v1',
  });
  const p = await repo.getProject(config.pilot.projectId);
  ok('Database', `${config.db.url ? 'Neon Postgres' : 'pglite'} connected, schema ensured, pilot="${p?.name}"`);
} catch (e) {
  fail('Database', e);
}

// 4. Object storage — put/get/exists round-trip
try {
  const s = makeStorage(config);
  const key = `healthcheck/ping-${Date.now()}.txt`;
  await s.put(key, new TextEncoder().encode('ping'), { contentType: 'text/plain' });
  const got = await s.get(key);
  const body = new TextDecoder().decode(got.bytes);
  const exists = await s.exists(key);
  if (body !== 'ping' || !exists) throw new Error('round-trip mismatch');
  ok('Storage', `${s.name} put/get/exists round-trip OK (bucket reachable)`);
} catch (e) {
  fail('Storage', e);
}

const failed = rows.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} provider(s) FAILED — see above.` : '\nAll providers OK ✓');
process.exit(failed.length ? 1 : 0);
