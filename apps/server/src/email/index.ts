/**
 * Email driver selection (auth plan §9), mirroring makeStorage/makeTranscriber:
 * `resend` when the key is present (or EMAIL_PROVIDER forces it), else `mock`.
 */
import type { AppConfig } from '../config.js';
import type { EmailDriver, EmailMessage } from './types.js';
import { makeMockEmail } from './mock.js';
import { makeResendEmail } from './resend.js';

export type { EmailDriver, EmailMessage, EmailAddress } from './types.js';
export { makeMockEmail } from './mock.js';
export { shareEmail, inviteEmail, type RenderedEmail } from './templates.js';

export function makeEmail(config: AppConfig): EmailDriver {
  if (config.email.provider === 'resend') {
    if (config.email.resendApiKey) {
      return makeResendEmail({ apiKey: config.email.resendApiKey, from: config.email.from });
    }
    console.warn('[email] EMAIL_PROVIDER=resend but RESEND_API_KEY is unset — using mock');
  }
  return makeMockEmail();
}

/**
 * Send one message, absorbing delivery failure into a logged { ok: false } instead of
 * throwing. Every fan-out caller (invitations, the Phase 8 per-recipient send loop) shares
 * this so one bounced address never rejects the whole request — the driver's send() throws
 * by contract; best-effort semantics live here, once.
 */
export async function sendBestEffort(
  email: EmailDriver,
  msg: EmailMessage,
  log: (obj: unknown, msg: string) => void,
): Promise<{ ok: boolean }> {
  try {
    await email.send(msg);
    return { ok: true };
  } catch (err) {
    log({ err }, 'email send failed (continuing)');
    return { ok: false };
  }
}
