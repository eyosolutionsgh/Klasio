import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  renderGuardianOtp,
  renderPasswordReset,
  renderSchoolInvitation,
} from './email-templates';

describe('escapeHtml', () => {
  it('neutralises the characters that close a tag or an attribute', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;',
    );
  });

  it('escapes ampersands first, so an escape is not itself re-escaped', () => {
    // &lt; must survive as &amp;lt; — running the & replacement last would produce &lt; back.
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves ordinary school names untouched', () => {
    expect(escapeHtml('Brighton Academy')).toBe('Brighton Academy');
  });
});

describe('renderSchoolInvitation', () => {
  const opts = {
    schoolName: 'Brighton Academy',
    acceptUrl: 'https://app.eyo.test/register?token=abc123',
    expiresAt: new Date('2026-08-18T00:00:00Z'),
  };

  it('carries the accept link in both bodies', () => {
    const { html, text } = renderSchoolInvitation(opts);
    expect(html).toContain(opts.acceptUrl);
    // The text part is the only body a plain-text client shows; a link-less one is a dead end.
    expect(text).toContain(opts.acceptUrl);
  });

  it('names the school in the subject so it is recognisable in a crowded inbox', () => {
    expect(renderSchoolInvitation(opts).subject).toContain('Brighton Academy');
  });

  it('states the expiry date', () => {
    expect(renderSchoolInvitation(opts).text).toContain(opts.expiresAt.toDateString());
  });

  /**
   * The guard that matters. `schoolName` is typed by whoever issued the invitation and lands
   * inside the markup — an unescaped one executes in the recipient's inbox.
   */
  it('escapes a school name carrying markup', () => {
    const { html } = renderSchoolInvitation({
      ...opts,
      schoolName: '<script>steal()</script>',
    });
    expect(html).not.toContain('<script>steal()</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes a url carrying a quote, which would otherwise break out of href', () => {
    const { html } = renderSchoolInvitation({
      ...opts,
      acceptUrl: 'https://x.test/"><script>steal()</script>',
    });
    expect(html).not.toContain('"><script>');
  });
});

describe('renderPasswordReset', () => {
  const opts = {
    name: 'Ama Mensah',
    schoolName: 'Brighton Academy',
    resetUrl: 'https://app.eyo.test/reset-password?token=xyz',
    expiresInMinutes: 30,
  };

  it('greets by first name only', () => {
    const { text } = renderPasswordReset(opts);
    expect(text).toContain('Hello Ama,');
    expect(text).not.toContain('Mensah');
  });

  it('falls back to a greeting rather than an empty name', () => {
    expect(renderPasswordReset({ ...opts, name: '' }).text).toContain('Hello there,');
  });

  it('states the window and that the link is single-use', () => {
    const { text } = renderPasswordReset(opts);
    expect(text).toContain('30 minutes');
    expect(text).toContain('used once');
  });

  it('tells a recipient who did not ask that ignoring it is safe', () => {
    // Reset emails are also what an attacker triggers against a victim's address; the copy has
    // to leave the victim knowing they need do nothing.
    expect(renderPasswordReset(opts).text).toContain('your password will not change');
  });
});

describe('renderGuardianOtp', () => {
  const opts = { schoolName: 'Brighton Academy', code: '048213', ttlMinutes: 10 };

  it('puts the code in the subject, where a phone shows it without opening the mail', () => {
    expect(renderGuardianOtp(opts).subject).toContain('048213');
  });

  it('carries the code in both bodies', () => {
    const { html, text } = renderGuardianOtp(opts);
    expect(html).toContain('048213');
    expect(text).toContain('048213');
  });

  it('preserves a leading zero', () => {
    // The code is generated as a zero-padded string; anything that treated it as a number would
    // send five digits and no code would ever verify.
    expect(renderGuardianOtp({ ...opts, code: '000042' }).text).toContain('000042');
  });

  it('warns against sharing, naming the school as the party that will never ask', () => {
    expect(renderGuardianOtp(opts).text).toContain('never ask you for this code');
  });
});
