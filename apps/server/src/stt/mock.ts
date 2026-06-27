/**
 * Deterministic mock transcriber — lets the whole pipeline run offline with no
 * Deepgram. Draws from the curated jobsite corpus so dry-run reports are realistic
 * (including the prepped-vs-poured / proper-noun / garbled edge cases). Ignores audio
 * bytes; maps observation id -> a corpus line (trailing number if present, else hash).
 */
import { MOCK_TRANSCRIPTS } from '../mock-corpus.js';
import type { AudioInput, TranscribeOptions, Transcriber, TranscriptResult } from './types.js';

function indexFor(id: string, len: number): number {
  const m = /(\d+)\D*$/.exec(id);
  if (m) return Number(m[1]) % len;
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % len;
}

export class MockTranscriber implements Transcriber {
  readonly name = 'mock';
  async transcribe(audio: AudioInput, _opts: TranscribeOptions): Promise<TranscriptResult> {
    const text = MOCK_TRANSCRIPTS[indexFor(audio.observationId, MOCK_TRANSCRIPTS.length)]!;
    return { text, confidence: 0.92, provider: this.name };
  }
}
