import { BASE_CONSTRUCTION_LEXICON } from '@fieldreport/contracts';
import type { AppConfig } from '../config.js';
import type { Transcriber } from './types.js';
import { MockTranscriber } from './mock.js';
import { DeepgramTranscriber } from './deepgram.js';

export function makeTranscriber(cfg: AppConfig): Transcriber {
  return cfg.stt.provider === 'deepgram' ? new DeepgramTranscriber(cfg) : new MockTranscriber();
}

/** base construction lexicon ∪ project glossary, deduped, capped for the STT API. */
export function assembleKeyterms(glossary: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of [...glossary, ...BASE_CONSTRUCTION_LEXICON]) {
    const t = term.trim();
    const k = t.toLowerCase();
    if (t && !seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  return out.slice(0, 100); // nova-3 keyterm hard limit (English monolingual); glossary is first so it's never truncated
}

export type { Transcriber } from './types.js';
