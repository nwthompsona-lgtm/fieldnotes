/**
 * Transcription seam (spec §8a). Makes the model *hear* domain words correctly via
 * keyterm/vocabulary biasing. Real provider = Deepgram Nova (keyterms); offline/dev
 * fallback = deterministic mock. Both implement `Transcriber`.
 */
export interface AudioInput {
  bytes: Uint8Array;
  /** Device-reported mime (iOS audio/mp4 vs audio/webm;opus elsewhere). Opaque to us. */
  mime: string;
  /** For logging/debug only. */
  observationId: string;
}

export interface TranscribeOptions {
  /** base construction lexicon + the project glossary, deduped (spec §8a). The single
   *  highest-leverage accuracy input is the project glossary (proper nouns). */
  keyterms: string[];
  /** BCP-47 language hint; default en-US. */
  language?: string;
}

export interface TranscriptResult {
  text: string;
  /** Provider confidence 0..1 if available (surfaced to admin for quality triage). */
  confidence?: number;
  provider: string;
}

export interface Transcriber {
  readonly name: string;
  transcribe(audio: AudioInput, opts: TranscribeOptions): Promise<TranscriptResult>;
}
