/**
 * Mock email driver: captures messages in memory (tests) and best-effort writes each
 * one as JSON under .data/email (manual inspection in local dev). Default when no
 * RESEND_API_KEY — nothing in local dev needs an account (T-3).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { EmailDriver, EmailMessage } from './types.js';

export interface MockEmailDriver extends EmailDriver {
  name: 'mock';
  /** Everything "sent", in order — the unit-test capture point. */
  sent: EmailMessage[];
}

export function makeMockEmail(dir = '.data/email'): MockEmailDriver {
  const sent: EmailMessage[] = [];
  return {
    name: 'mock',
    sent,
    async send(msg) {
      sent.push(msg);
      const id = `mock-${sent.length}`;
      // Disk write is best-effort: a read-only FS must not fail the caller's flow.
      try {
        const outDir = resolve(process.cwd(), dir);
        await mkdir(outDir, { recursive: true });
        const safeTo = msg.to.email.replace(/[^a-z0-9.@_-]/gi, '_');
        await writeFile(
          resolve(outDir, `${Date.now()}-${id}-${safeTo}.json`),
          JSON.stringify(msg, null, 2),
        );
      } catch {
        /* in-memory capture is the source of truth */
      }
      console.log(`[email:mock] to=${msg.to.email} subject=${JSON.stringify(msg.subject)}`);
      return { id };
    },
  };
}
