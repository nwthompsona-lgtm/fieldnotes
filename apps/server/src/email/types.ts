/**
 * Email seam (auth plan §9): a pluggable EmailDriver mirroring the storage/STT/
 * synthesis provider pattern — `resend` in prod, `mock` (disk + log) when no key —
 * so the whole invite/send flow runs offline with no account.
 */
export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailMessage {
  to: EmailAddress;
  subject: string;
  html: string;
  text: string;
  /** Display-name override on the configured From address, e.g. "Jake Romero via
   *  FieldReport" (D-9). The underlying address stays the verified EMAIL_FROM one. */
  fromName?: string;
  /** Replies go to the human sender, not the system address (D-9). */
  replyTo?: EmailAddress;
}

export interface EmailDriver {
  name: 'resend' | 'mock';
  /** Sends one message. Throws on failure — callers decide best-effort vs fail. */
  send(msg: EmailMessage): Promise<{ id: string }>;
}

/** `fromWithDisplayName('FieldReport <reports@x.app>', 'Jake via FieldReport')` →
 *  `"Jake via FieldReport" <reports@x.app>`. Quotes/escapes the display name. */
export function fromWithDisplayName(base: string, displayName: string): string {
  const m = /<([^>]+)>/.exec(base);
  const addr = m ? m[1]! : base.trim();
  return `${JSON.stringify(displayName)} <${addr}>`;
}

/** Loose-but-useful address shape check: something@something.tld, no spaces/brackets. */
const ADDR_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** Parse an EMAIL_FROM value: `email@example.com` or `Name <email@example.com>`.
 *  Returns null on anything else (stray quotes, missing bracket, trailing text) so the
 *  boot check can fail loudly instead of Resend rejecting every send at runtime. */
export function parseFromAddress(base: string): { name?: string; email: string } | null {
  const s = base.trim();
  const m = /^(.*)<([^<>]+)>$/.exec(s);
  if (m) {
    const email = m[2]!.trim();
    if (!ADDR_RE.test(email)) return null;
    const rawName = m[1]!.trim().replace(/^"(.*)"$/, '$1').trim();
    return rawName ? { name: rawName, email } : { email };
  }
  return ADDR_RE.test(s) ? { email: s } : null;
}

export const formatAddress = (a: EmailAddress): string =>
  a.name ? `${JSON.stringify(a.name)} <${a.email}>` : a.email;
