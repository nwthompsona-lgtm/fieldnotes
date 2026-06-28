/**
 * Claude synthesizer (the IP in production). Sends the frozen system prompt + the
 * ordered transcripts, parses the model's JSON (tolerant extraction + zod validation),
 * with one repair retry. Wrapped in a LangSmith trace when tracing is enabled so the
 * prompt/output can be inspected and iterated (spec §3, §8b).
 *
 * Uses messages.create (stable across SDK versions) + prompt-enforced JSON rather than
 * the structured-outputs helper, so it works on the installed SDK and is model-agnostic.
 */
import Anthropic from '@anthropic-ai/sdk';
import { traceable } from 'langsmith/traceable';
import type { AppConfig } from '../config.js';
import {
  SYSTEM_PROMPT,
  SYNTHESIS_PROMPT_VERSION,
  SUMMARY_SYSTEM_PROMPT,
  buildUserMessage,
  buildSummaryMessage,
} from './prompt.js';
import {
  SynthesisOutput,
  type SynthesisInput,
  type SummaryInput,
  type Synthesizer,
} from './types.js';

function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence?.[1]) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

export class ClaudeSynthesizer implements Synthesizer {
  readonly name = 'claude';
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private tracingEnabled: boolean;
  private project: string;
  private run: (input: SynthesisInput) => Promise<SynthesisOutput>;
  private runSummary: (input: SummaryInput) => Promise<string>;

  constructor(cfg: AppConfig) {
    if (!cfg.synthesis.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY required for claude');
    // maxRetries: retry transient connection/5xx/429 errors (real walks WILL hit these).
    this.client = new Anthropic({ apiKey: cfg.synthesis.anthropicApiKey, maxRetries: 4 });
    this.model = cfg.synthesis.model;
    this.maxTokens = cfg.synthesis.maxTokens;
    this.tracingEnabled = cfg.langsmith.enabled;
    this.project = cfg.langsmith.project;
    const core = (input: SynthesisInput) => this.execute(input);
    const summaryCore = (input: SummaryInput) => this.executeSummary(input);
    this.run = cfg.langsmith.enabled
      ? (traceable(core, {
          name: 'fieldreport.synthesize',
          project_name: cfg.langsmith.project,
          metadata: { promptVersion: SYNTHESIS_PROMPT_VERSION, model: this.model },
        }) as typeof core)
      : core;
    this.runSummary = cfg.langsmith.enabled
      ? (traceable(summaryCore, {
          name: 'fieldreport.resummarize',
          project_name: cfg.langsmith.project,
          metadata: { model: this.model },
        }) as typeof summaryCore)
      : summaryCore;
  }

  synthesize(input: SynthesisInput): Promise<SynthesisOutput> {
    return this.run(input);
  }

  resummarize(input: SummaryInput): Promise<string> {
    return this.runSummary(input);
  }

  /** Concatenated assistant text from a Claude message. */
  private static textOf(msg: Anthropic.Message): string {
    return msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }

  /**
   * One streaming Claude call. When LangSmith is on it's traced as a nested `llm` run, so the
   * system prompt, the user message, and token usage are all inspectable in the trace.
   * (langsmith 0.2.x ships no Anthropic SDK wrapper, so we instrument the call ourselves.)
   *
   * Stream rather than a single non-streaming request: a ~15s synthesis response left the
   * connection idle long enough for an intermediary (Render egress) to drop it with
   * "Premature close". Streaming keeps bytes flowing and avoids that (claude-api guidance).
   */
  private streamMessage(
    runName: string,
    system: string,
    userMessage: string,
    maxTokens: number,
  ): Promise<Anthropic.Message> {
    const call = () =>
      this.client.messages
        .stream({
          model: this.model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: userMessage }],
        })
        .finalMessage();
    if (!this.tracingEnabled) return call();
    return traceable(call, {
      name: runName,
      run_type: 'llm',
      project_name: this.project,
      metadata: { ls_provider: 'anthropic', ls_model_name: this.model },
      // The wrapped call takes no args; supply the LLM input/output we want shown in the trace
      // (system as the first message so LangSmith renders it as a chat with the system prompt).
      processInputs: () => ({
        model: this.model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userMessage },
        ],
      }),
      processOutputs: (o) => {
        const m = o as Partial<Anthropic.Message> & {
          usage?: { input_tokens: number; output_tokens: number };
        };
        return {
          role: 'assistant',
          content: Array.isArray(m.content) ? ClaudeSynthesizer.textOf(m as Anthropic.Message) : undefined,
          ...(m.usage
            ? {
                usage_metadata: {
                  input_tokens: m.usage.input_tokens,
                  output_tokens: m.usage.output_tokens,
                  total_tokens: m.usage.input_tokens + m.usage.output_tokens,
                },
              }
            : {}),
        };
      },
    })();
  }

  private async executeSummary(input: SummaryInput): Promise<string> {
    const res = await this.streamMessage(
      'anthropic.resummarize',
      SUMMARY_SYSTEM_PROMPT,
      buildSummaryMessage(input),
      600,
    );
    if ((res.stop_reason as string) === 'refusal') {
      throw new Error('summary refused by safety classifier');
    }
    return ClaudeSynthesizer.textOf(res).trim();
  }

  private async callModel(userMessage: string): Promise<string> {
    const res = await this.streamMessage(
      'anthropic.synthesize',
      SYSTEM_PROMPT,
      userMessage,
      this.maxTokens,
    );
    if ((res.stop_reason as string) === 'refusal') {
      throw new Error('synthesis refused by safety classifier');
    }
    return ClaudeSynthesizer.textOf(res);
  }

  private tryParse(text: string): SynthesisOutput | null {
    try {
      const parsed = SynthesisOutput.safeParse(extractJson(text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async execute(input: SynthesisInput): Promise<SynthesisOutput> {
    const userMessage = buildUserMessage(input);
    let out = this.tryParse(await this.callModel(userMessage));
    if (!out) {
      const repair = `${userMessage}\n\nYour previous reply was not valid JSON of the required shape. Reply again with ONLY the JSON object described above — no prose, no code fence.`;
      out = this.tryParse(await this.callModel(repair));
    }
    if (!out) throw new Error('synthesis: model did not return parseable JSON');
    return this.reconcile(out, input);
  }

  /** Guarantee one output per input id, in order (never drop or invent observations). */
  private reconcile(out: SynthesisOutput, input: SynthesisInput): SynthesisOutput {
    const byId = new Map(out.observations.map((o) => [o.id, o]));
    const observations = [...input.observations]
      .sort((a, b) => a.order - b.order)
      .map(
        (o) =>
          byId.get(o.id) ?? {
            id: o.id,
            cleanedDescription:
              'Observation recorded; description unavailable and should be reviewed.',
          },
      );
    return { summary: out.summary ?? '', observations };
  }
}
