/**
 * Email templates (auth plan §9): plain, on-brand (blue accent, IBM Plex with system
 * fallbacks), one clear button, always with a text/plain twin. Inline styles only —
 * email clients ignore <style> blocks.
 */
import { escapeHtml as esc } from '../html.js';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const BLUE = '#1d4ed8';
const INK = '#1f2937';
const MUTED = '#6b7280';
const FONT =
  "'IBM Plex Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Shared shell: centered card, header wordmark, CTA button, muted footer line. */
function shell(args: { heading: string; bodyHtml: string; cta: { label: string; url: string }; footer: string }): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6f8;font-family:${FONT};color:${INK};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">
<tr><td style="padding:28px 32px 0;">
  <div style="font-size:14px;font-weight:700;letter-spacing:.02em;color:${BLUE};">FieldReport</div>
  <h1 style="font-size:20px;line-height:1.35;margin:14px 0 0;">${esc(args.heading)}</h1>
</td></tr>
<tr><td style="padding:12px 32px 0;font-size:15px;line-height:1.55;">${args.bodyHtml}</td></tr>
<tr><td style="padding:24px 32px;">
  <a href="${args.cta.url}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px;">${esc(args.cta.label)}</a>
</td></tr>
<tr><td style="padding:0 32px 28px;font-size:12.5px;line-height:1.5;color:${MUTED};">${esc(args.footer)}
  <br/>If the button doesn't work, copy this link: <span style="word-break:break-all;">${esc(args.cta.url)}</span></td></tr>
</table></td></tr></table></body></html>`;
}

const shortDate = (isoDate: string): string =>
  new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** The per-recipient share email (D-9): body is a personal link — never an attachment. */
export function shareEmail(args: {
  projectName: string;
  /** Walk date, YYYY-MM-DD. */
  date: string;
  senderName: string;
  recipientName: string;
  /** Optional note typed in the Send modal. */
  message?: string;
  /** The per-person capability link (${publicBaseUrl}/s/<token>). */
  link: string;
  expiresAt?: Date;
}): RenderedEmail {
  const subject = `Daily field report — ${args.projectName} — ${shortDate(args.date)}`;
  const expiry = args.expiresAt
    ? `This link is personal to you and expires ${args.expiresAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`
    : 'This link is personal to you.';
  const note = args.message
    ? `<p style="margin:12px 0 0;padding:12px 14px;background:#f4f6f8;border-radius:8px;">${esc(args.message)}</p>`
    : '';
  const html = shell({
    heading: subject,
    bodyHtml: `<p style="margin:0;">Hi ${esc(args.recipientName)},</p>
<p style="margin:12px 0 0;">${esc(args.senderName)} shared the daily field report for
<strong>${esc(args.projectName)}</strong> (${esc(shortDate(args.date))}) with you. View it in your
browser or download the PDF from the report page.</p>${note}`,
    cta: { label: 'View report', url: args.link },
    footer: `Sent by ${args.senderName} via FieldReport. ${expiry}`,
  });
  const text = [
    `Hi ${args.recipientName},`,
    '',
    `${args.senderName} shared the daily field report for ${args.projectName} (${shortDate(args.date)}) with you.`,
    ...(args.message ? ['', `Note from ${args.senderName}: ${args.message}`] : []),
    '',
    `View it here: ${args.link}`,
    '',
    `Sent by ${args.senderName} via FieldReport. ${expiry}`,
  ].join('\n');
  return { subject, html, text };
}

/** Org invitation (Phase 6): link lands on the web app's accept screen. */
export function inviteEmail(args: {
  orgName: string;
  inviterName: string;
  acceptUrl: string;
  orgRole: 'admin' | 'member';
}): RenderedEmail {
  const subject = `${args.inviterName} invited you to ${args.orgName} on FieldReport`;
  const roleLine =
    args.orgRole === 'admin'
      ? `You'll join as an <strong>admin</strong> — you can manage projects, people, and settings.`
      : `You'll join as a member and see the projects you're assigned to.`;
  const html = shell({
    heading: subject,
    bodyHtml: `<p style="margin:0;">${esc(args.inviterName)} invited you to join
<strong>${esc(args.orgName)}</strong> on FieldReport — daily field reports from the crews
on site, reviewed and delivered to your inbox.</p>
<p style="margin:12px 0 0;">${roleLine}</p>`,
    cta: { label: 'Accept invitation', url: args.acceptUrl },
    footer: `Invitation from ${args.inviterName} (${args.orgName}) via FieldReport. If you weren't expecting this, you can ignore it.`,
  });
  const text = [
    `${args.inviterName} invited you to join ${args.orgName} on FieldReport.`,
    '',
    args.orgRole === 'admin'
      ? `You'll join as an admin - you can manage projects, people, and settings.`
      : `You'll join as a member and see the projects you're assigned to.`,
    '',
    `Accept here: ${args.acceptUrl}`,
    '',
    `If you weren't expecting this, you can ignore it.`,
  ].join('\n');
  return { subject, html, text };
}
