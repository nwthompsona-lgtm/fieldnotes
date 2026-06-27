/**
 * Deepgram transcriber (prod). Biases recognition toward the assembled keyterms
 * (base construction lexicon + project glossary, §8). nova-3 uses `keyterm`; nova-2
 * uses `keywords`. Recoverable per-clip failures are surfaced to the caller, which
 * records an empty transcript rather than failing the whole report.
 */
import { createClient } from '@deepgram/sdk';
import type { AppConfig } from '../config.js';
import type { AudioInput, TranscribeOptions, Transcriber, TranscriptResult } from './types.js';

export class DeepgramTranscriber implements Transcriber {
  readonly name = 'deepgram';
  private client: ReturnType<typeof createClient>;
  private model: string;

  constructor(cfg: AppConfig) {
    if (!cfg.stt.deepgramApiKey) throw new Error('DEEPGRAM_API_KEY required for deepgram');
    this.client = createClient(cfg.stt.deepgramApiKey);
    this.model = cfg.stt.model;
  }

  async transcribe(audio: AudioInput, opts: TranscribeOptions): Promise<TranscriptResult> {
    const isNova3 = this.model.startsWith('nova-3');
    const biasing = isNova3
      ? { keyterm: opts.keyterms }
      : { keywords: opts.keyterms.map((t) => `${t}:2`) };

    const { result, error } = await this.client.listen.prerecorded.transcribeFile(
      Buffer.from(audio.bytes),
      {
        model: this.model,
        language: opts.language ?? 'en-US',
        smart_format: true,
        punctuate: true,
        ...biasing,
      },
    );
    if (error) throw new Error(`deepgram: ${error.message ?? String(error)}`);

    const alt = result?.results?.channels?.[0]?.alternatives?.[0];
    return {
      text: alt?.transcript ?? '',
      confidence: alt?.confidence,
      provider: this.name,
    };
  }
}
