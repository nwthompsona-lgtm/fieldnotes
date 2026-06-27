import type { AppConfig } from '../config.js';
import type { Synthesizer } from './types.js';
import { MockSynthesizer } from './mock.js';
import { ClaudeSynthesizer } from './claude.js';

export function makeSynthesizer(cfg: AppConfig): Synthesizer {
  return cfg.synthesis.provider === 'claude' ? new ClaudeSynthesizer(cfg) : new MockSynthesizer();
}

export type { Synthesizer } from './types.js';
export { SYSTEM_PROMPT, SYNTHESIS_PROMPT_VERSION } from './prompt.js';
