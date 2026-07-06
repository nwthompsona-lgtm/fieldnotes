/**
 * Resend driver (auth plan §9, T-3): API-based send (no SMTP), one verified
 * FieldReport domain for now. Per-send display-name override + reply-to the human
 * sender (D-9). Ops prerequisite before real sends: verify the domain in Resend
 * (SPF/DKIM/DMARC) — the mock driver covers everything until then.
 */
import { Resend } from 'resend';
import {
  formatAddress,
  fromWithDisplayName,
  type EmailDriver,
} from './types.js';

export function makeResendEmail(opts: { apiKey: string; from: string }): EmailDriver {
  const client = new Resend(opts.apiKey);
  return {
    name: 'resend',
    async send(msg) {
      const from = msg.fromName ? fromWithDisplayName(opts.from, msg.fromName) : opts.from;
      const { data, error } = await client.emails.send({
        from,
        to: [formatAddress(msg.to)],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        replyTo: msg.replyTo ? formatAddress(msg.replyTo) : undefined,
      });
      if (error) throw new Error(`resend send failed: ${error.name}: ${error.message}`);
      return { id: data?.id ?? 'unknown' };
    },
  };
}
