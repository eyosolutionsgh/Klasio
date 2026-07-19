/**
 * Every email this product sends, as pure functions.
 *
 * Kept out of the module file on purpose: the send path needs a live provider to exercise, but
 * the wording, the links and the escaping are decidable from arguments alone, so they belong
 * where the rest of the tested logic lives (see the `common/` convention — logic in `*.module.ts`
 * has historically gone uncovered).
 *
 * Each function returns the three parts a send needs — `subject`, `html`, `text`. Both bodies are
 * always produced: a text/plain alternative is what keeps the message out of spam folders and is
 * the only thing a screen reader or a feature phone will ever see.
 */

/**
 * Escape interpolated values before they reach the HTML body.
 *
 * Not defensive boilerplate — this is multi-tenant. `schoolName` is typed by whoever registered
 * the school, guardian and staff names are typed by school staff, and all three land inside the
 * markup below. Without this, a school named `<img src=x onerror=...>` would execute in the
 * inbox of every recipient the vendor invited.
 */
export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** EYO's brand green, matching the portal. Inlined — email clients strip <style> blocks. */
const BRAND = '#0F6E4F';

/**
 * Shared shell for every message.
 *
 * Table-based and inline-styled because that is what Outlook renders. `max-width` with a centred
 * table is the layout that survives both desktop clients and the narrow phone screens most
 * Ghanaian guardians read mail on.
 */
function layout(opts: { heading: string; bodyHtml: string; footer?: string }): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f5f4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f4;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
        <tr><td>
          <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:${BRAND};">${opts.heading}</h1>
          ${opts.bodyHtml}
          <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e7e5;font-size:12px;color:#6b706b;">
            ${opts.footer ?? 'EYO School Management &middot; Accra, Ghana'}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** A one-time code, rendered big enough to read off a phone without zooming. */
function codeBlock(code: string): string {
  return `<p style="margin:24px 0;font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;color:${BRAND};font-family:monospace;">${escapeHtml(code)}</p>`;
}

/** A single call-to-action. Always paired with the bare URL — clients and proxies mangle buttons. */
function button(href: string, label: string): string {
  const safe = escapeHtml(href);
  return `<p style="margin:24px 0;text-align:center;">
    <a href="${safe}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">${escapeHtml(label)}</a>
  </p>
  <p style="margin:16px 0;font-size:13px;color:#6b706b;word-break:break-all;">
    Or paste this into your browser:<br /><a href="${safe}" style="color:${BRAND};">${safe}</a>
  </p>`;
}

/**
 * The invitation that provisions a school.
 *
 * This link is the entire onboarding path — a school cannot self-register, and until this email
 * existed the token was read off the vendor console and passed on by hand.
 */
export function renderSchoolInvitation(opts: {
  schoolName: string;
  acceptUrl: string;
  expiresAt: Date;
}): RenderedEmail {
  const school = escapeHtml(opts.schoolName);
  const expires = opts.expiresAt.toDateString();
  return {
    subject: `Set up ${opts.schoolName} on EYO School Management`,
    html: layout({
      heading: 'Your school is ready to set up',
      bodyHtml: `
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">EYO has invited you to set up <strong>${school}</strong> on EYO School Management.</p>
        <p style="margin:0;font-size:15px;line-height:1.6;">Follow the link below to create your owner account and get started.</p>
        ${button(opts.acceptUrl, 'Set up my school')}
        <p style="margin:0;font-size:13px;color:#6b706b;line-height:1.6;">This invitation expires on ${escapeHtml(expires)} and can only be used by this email address. If you were not expecting it, you can ignore this message.</p>`,
    }),
    text: `EYO has invited you to set up ${opts.schoolName} on EYO School Management.

Create your owner account here:
${opts.acceptUrl}

This invitation expires on ${expires} and can only be used by this email address. If you were not expecting it, you can ignore this message.

EYO School Management, Accra, Ghana`,
  };
}

/**
 * Staff password reset.
 *
 * The copy deliberately does not confirm that an account exists — the endpoint answers the same
 * way either way, and an email that said "no account found" would undo that.
 */
export function renderPasswordReset(opts: {
  name: string;
  schoolName: string;
  resetUrl: string;
  expiresInMinutes: number;
}): RenderedEmail {
  const first = escapeHtml(opts.name.split(' ')[0] || 'there');
  const school = escapeHtml(opts.schoolName);
  return {
    subject: `Reset your ${opts.schoolName} password`,
    html: layout({
      heading: 'Reset your password',
      bodyHtml: `
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Hello ${first},</p>
        <p style="margin:0;font-size:15px;line-height:1.6;">Someone asked to reset the password for your <strong>${school}</strong> account. Choose a new one using the link below.</p>
        ${button(opts.resetUrl, 'Choose a new password')}
        <p style="margin:0;font-size:13px;color:#6b706b;line-height:1.6;">This link expires in ${opts.expiresInMinutes} minutes and can be used once. If you did not ask for this, ignore this email — your password will not change, and signing in normally cancels the request.</p>`,
      footer: `${school} &middot; sent by EYO School Management`,
    }),
    text: `Hello ${opts.name.split(' ')[0] || 'there'},

Someone asked to reset the password for your ${opts.schoolName} account. Choose a new one here:

${opts.resetUrl}

This link expires in ${opts.expiresInMinutes} minutes and can be used once. If you did not ask for this, ignore this email — your password will not change, and signing in normally cancels the request.

${opts.schoolName}, sent by EYO School Management`,
  };
}

/**
 * Guardian sign-in code, for families who gave the school an email address.
 *
 * The wording matches the SMS deliberately. A parent who gets both should see one code and one
 * message, not two that look like two different requests.
 */
export function renderGuardianOtp(opts: {
  schoolName: string;
  code: string;
  ttlMinutes: number;
}): RenderedEmail {
  const school = escapeHtml(opts.schoolName);
  return {
    subject: `${opts.code} is your ${opts.schoolName} sign-in code`,
    html: layout({
      heading: 'Your sign-in code',
      bodyHtml: `
        <p style="margin:0;font-size:15px;line-height:1.6;">Use this code to sign in to the <strong>${school}</strong> guardian portal.</p>
        ${codeBlock(opts.code)}
        <p style="margin:0;font-size:13px;color:#6b706b;line-height:1.6;">It expires in ${opts.ttlMinutes} minutes. Never share it — ${school} will never ask you for this code.</p>`,
      footer: `${school} &middot; sent by EYO School Management`,
    }),
    text: `${opts.code} is your ${opts.schoolName} guardian portal sign-in code.

It expires in ${opts.ttlMinutes} minutes. Never share it — ${opts.schoolName} will never ask you for this code.

${opts.schoolName}, sent by EYO School Management`,
  };
}
