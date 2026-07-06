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

export const formatAddress = (a: EmailAddress): string =>
  a.name ? `${JSON.stringify(a.name)} <${a.email}>` : a.email;
