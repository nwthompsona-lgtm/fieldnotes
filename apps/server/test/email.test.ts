/**
 * Phase 5 email seam (AUTH_MULTITENANCY_PLAN.md §9): mock driver captures sends,
 * driver selection defaults to mock without a key, both templates render subject/
 * html/text, and the From display-name override quotes correctly.
 */
import { describe, it, expect } from 'vitest';
import { makeEmail, makeMockEmail, shareEmail, inviteEmail } from '../src/email/index.js';
import { fromWithDisplayName, formatAddress } from '../src/email/types.js';
import { config, type AppConfig } from '../src/config.js';

describe('mock driver', () => {
  it('captures sent messages in order and returns ids', async () => {
    const mock = makeMockEmail('.data/test-email');
    const r1 = await mock.send({
      to: { email: 'najib@jma.com', name: 'Najib K' },
      subject: 'S1',
      html: '<p>one</p>',
      text: 'one',
    });
    await mock.send({ to: { email: 'two@x.com' }, subject: 'S2', html: '<p>2</p>', text: '2' });
    expect(r1.id).toBe('mock-1');
    expect(mock.sent).toHaveLength(2);
    expect(mock.sent[0]!.to.email).toBe('najib@jma.com');
    expect(mock.sent[1]!.subject).toBe('S2');
  });
});

describe('driver selection (makeEmail)', () => {
  it('mock when no key; resend when key present; forced-resend-without-key falls back', () => {
    const base = { ...config } as AppConfig;
    const noKey = {
      ...base,
      email: { provider: 'mock', resendApiKey: undefined, from: 'FieldReport <r@x.app>' },
    } as AppConfig;
    expect(makeEmail(noKey).name).toBe('mock');

    const withKey = {
      ...base,
      email: { provider: 'resend', resendApiKey: 're_test_123', from: 'FieldReport <r@x.app>' },
    } as AppConfig;
    expect(makeEmail(withKey).name).toBe('resend');

    const forcedNoKey = {
      ...base,
      email: { provider: 'resend', resendApiKey: undefined, from: 'FieldReport <r@x.app>' },
    } as AppConfig;
    expect(makeEmail(forcedNoKey).name).toBe('mock');
  });
});

describe('from/display-name helpers', () => {
  it('overrides only the display name, keeping the verified address', () => {
    expect(fromWithDisplayName('FieldReport <reports@fieldreport.app>', 'Jake via FieldReport')).toBe(
      '"Jake via FieldReport" <reports@fieldreport.app>',
    );
    expect(fromWithDisplayName('reports@fieldreport.app', 'A "B" C')).toBe(
      '"A \\"B\\" C" <reports@fieldreport.app>',
    );
    expect(formatAddress({ email: 'x@y.com', name: 'X Y' })).toBe('"X Y" <x@y.com>');
    expect(formatAddress({ email: 'x@y.com' })).toBe('x@y.com');
  });
});

describe('templates', () => {
  it('shareEmail: subject per §9, link + names in both bodies, message included', () => {
    const r = shareEmail({
      projectName: 'Watson Island',
      date: '2026-06-28',
      senderName: 'Jake Romero',
      recipientName: 'Najib K',
      message: 'Pour is <tomorrow> — heads up.',
      link: 'https://srv.example/s/tok_abc',
      expiresAt: new Date('2026-07-28T00:00:00Z'),
    });
    expect(r.subject).toBe('Daily field report — Watson Island — Jun 28');
    for (const body of [r.html, r.text]) {
      expect(body).toContain('https://srv.example/s/tok_abc');
      expect(body).toContain('Najib K');
      expect(body).toContain('Jake Romero');
    }
    expect(r.html).toContain('Pour is &lt;tomorrow&gt;'); // html-escaped note
    expect(r.text).toContain('Pour is <tomorrow>');
  });

  it('inviteEmail: org + inviter + accept link in both bodies; role phrasing differs', () => {
    const admin = inviteEmail({
      orgName: 'Watson Builders',
      inviterName: 'Jake Romero',
      acceptUrl: 'https://app.example/accept?token=inv_t1',
      orgRole: 'admin',
    });
    expect(admin.subject).toContain('Watson Builders');
    for (const body of [admin.html, admin.text]) {
      expect(body).toContain('https://app.example/accept?token=inv_t1');
      expect(body).toContain('Jake Romero');
    }
    expect(admin.html).toContain('admin');

    const member = inviteEmail({
      orgName: 'Watson Builders',
      inviterName: 'Jake Romero',
      acceptUrl: 'https://app.example/accept?token=inv_t2',
      orgRole: 'member',
    });
    expect(member.text).toContain('member');
  });
});
