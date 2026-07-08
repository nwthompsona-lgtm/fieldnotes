/**
 * Email templates (auth plan §9, styled per the Flux design handoff §EMAILS): a blue
 * brand band, one clear full-width button, a quiet private-link/expiry line, and a muted
 * footer strip — always with a text/plain twin. Inline styles only (email clients ignore
 * <style> blocks), explicit colors on every element + color-scheme:light so dark-mode
 * clients don't invert the card into mush.
 */
import { escapeHtml as esc } from '../html.js';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// Flux (light) tokens, fixed — email has no theming.
const PRIMARY = '#2b54e0';
const INK = '#10151d';
const MUTED = '#667283';
const LINE = '#e6ebf2';
const LINE_STRONG = '#d5dbe6';
const PAGE_BG = '#eef2f7';
const STRIP_BG = '#f3f6fb';
const FONT =
  "'Plus Jakarta Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Shared shell: brand band, heading, body, full-width CTA, meta line, footer strip. */
function shell(args: {
  heading: string;
  bodyHtml: string;
  cta: { label: string; url: string };
  /** Quiet line under the CTA (private-link/expiry note). Already-escaped HTML. */
  metaHtml?: string;
  /** Footer strip content. Already-escaped HTML. */
  footerHtml: string;
}): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="color-scheme" content="light"/><meta name="supported-color-schemes" content="light"/></head>
<body style="margin:0;padding:24px 12px;background:${PAGE_BG};font-family:${FONT};color:${INK};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden;">
<tr><td style="background:${PRIMARY};padding:20px 26px;">
  <span style="font-size:18px;font-weight:700;letter-spacing:-.01em;color:#ffffff;">FieldReport</span>
</td></tr>
<tr><td style="padding:26px 26px 0;">
  <h1 style="font-size:21px;line-height:1.25;font-weight:700;letter-spacing:-.01em;margin:0;color:${INK};">${esc(args.heading)}</h1>
</td></tr>
<tr><td style="padding:11px 26px 0;font-size:15px;line-height:1.55;color:${INK};">${args.bodyHtml}</td></tr>
<tr><td style="padding:20px 26px 0;">
  <a href="${args.cta.url}" style="display:block;text-align:center;background:${PRIMARY};color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:15px;border-radius:10px;">${esc(args.cta.label)} &#8594;</a>
</td></tr>
${args.metaHtml ? `<tr><td style="padding:16px 26px 0;font-size:12.5px;line-height:1.5;color:${MUTED};">&#128274; ${args.metaHtml}</td></tr>` : ''}
<tr><td style="padding:16px 26px 24px;font-size:12px;line-height:1.5;color:${MUTED};">If the button doesn't work, copy this link: <span style="word-break:break-all;color:${MUTED};">${esc(args.cta.url)}</span></td></tr>
<tr><td style="border-top:1px solid ${LINE};padding:16px 26px;background:${STRIP_BG};font-size:11.5px;line-height:1.5;color:${MUTED};">${args.footerHtml}</td></tr>
</table></td></tr></table></body></html>`;
}

const shortDate = (isoDate: string): string =>
  new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const longDate = (isoDate: string): string =>
  new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const fmtExpiry = (d: Date): string =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** The per-recipient distribution email (D-9, design §EMAILS): one View-report button on
 *  a personal link — never an attachment; the optional Send-modal note rides as a quote. */
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
    ? `This is a private link just for you &middot; it expires ${esc(fmtExpiry(args.expiresAt))} &middot; no attachment — view it in your browser.`
    : `This is a private link just for you &middot; no attachment — view it in your browser.`;
  const note = args.message
    ? `<div style="border-left:3px solid ${LINE_STRONG};padding:4px 0 4px 14px;margin:16px 0 0;color:${MUTED};font-size:14px;line-height:1.55;font-style:italic;">&ldquo;${esc(args.message)}&rdquo; &mdash; ${esc(args.senderName)}</div>`
    : '';
  const html = shell({
    heading: `Daily field report for ${args.projectName}`,
    bodyHtml: `<p style="margin:0;">Hi ${esc(args.recipientName)},</p>
<p style="margin:11px 0 0;">${esc(args.senderName)} shared the <strong>${esc(longDate(args.date))}</strong> daily field report for <strong>${esc(args.projectName)}</strong> with you.</p>${note}`,
    cta: { label: 'View report', url: args.link },
    metaHtml: expiry,
    footerHtml: `You received this because ${esc(args.senderName)} shared a report with you on FieldReport. Replies go straight to ${esc(args.senderName)}.`,
  });
  const textExpiry = args.expiresAt
    ? `This is a private link just for you - it expires ${fmtExpiry(args.expiresAt)}. No attachment - view it in your browser.`
    : 'This is a private link just for you. No attachment - view it in your browser.';
  const text = [
    `Hi ${args.recipientName},`,
    '',
    `${args.senderName} shared the ${longDate(args.date)} daily field report for ${args.projectName} with you.`,
    ...(args.message ? ['', `Note from ${args.senderName}: ${args.message}`] : []),
    '',
    `View it here: ${args.link}`,
    '',
    textExpiry,
    `Replies go straight to ${args.senderName}.`,
  ].join('\n');
  return { subject, html, text };
}

/** Org invitation (Phase 6, design §EMAILS): Accept button + expiry note. */
export function inviteEmail(args: {
  orgName: string;
  inviterName: string;
  /** Shown in the invited-by line when known. */
  inviterEmail?: string;
  acceptUrl: string;
  orgRole: 'admin' | 'member';
  /** Matches the server-side invitation TTL (invitations.ts). */
  expiresInDays?: number;
}): RenderedEmail {
  const subject = `${args.inviterName} invited you to ${args.orgName} on FieldReport`;
  const ttl = args.expiresInDays ?? 14;
  const roleLine =
    args.orgRole === 'admin'
      ? `as an <strong>admin</strong> — manage projects, people, and settings`
      : `as a <strong>member</strong> — walk the site, capture observations, and send reports`;
  const invitedBy = `<div style="background:${STRIP_BG};border:1px solid ${LINE};border-radius:11px;padding:13px 15px;margin:18px 0 0;font-size:13px;color:${MUTED};">Invited by <span style="color:${INK};font-weight:600;">${esc(args.inviterName)}</span>${args.inviterEmail ? ` &middot; ${esc(args.inviterEmail)}` : ''}</div>`;
  const html = shell({
    heading: `You've been invited to ${args.orgName}`,
    bodyHtml: `<p style="margin:0;">${esc(args.inviterName)} invited you to join <strong>${esc(args.orgName)}</strong> on FieldReport ${roleLine}.</p>${invitedBy}`,
    cta: { label: 'Accept invitation', url: args.acceptUrl },
    metaHtml: `This invitation expires in ${ttl} days. If you weren't expecting it, you can ignore this email.`,
    footerHtml: `FieldReport &middot; offline-first field reporting for construction teams.`,
  });
  const text = [
    `${args.inviterName} invited you to join ${args.orgName} on FieldReport`,
    args.orgRole === 'admin'
      ? `as an admin - manage projects, people, and settings.`
      : `as a member - walk the site, capture observations, and send reports.`,
    '',
    `Accept here: ${args.acceptUrl}`,
    '',
    `This invitation expires in ${ttl} days. If you weren't expecting it, you can ignore this email.`,
  ].join('\n');
  return { subject, html, text };
}
