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

/**
 * An image that travels with the message and is referenced from the HTML as `cid:<id>`.
 *
 * School crests cannot be linked. They live in tenant-scoped storage behind an authenticated
 * proxy (`/api/proxy/school/logo`) precisely so one school's crest is not fetchable by anyone
 * holding a URL, and an email client has no session to authenticate with. Embedding the bytes is
 * the only way to show a crest without putting school assets on a public URL.
 */
export interface InlineImage {
  /** Referenced as `cid:<id>` in the HTML. */
  id: string;
  filename: string;
  content: Buffer;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  inlineImages?: InlineImage[];
}

/**
 * The portal's own tokens, from `globals.css`. Inlined as literals because email clients strip
 * <style> blocks and none of them resolve CSS custom properties.
 */
const BRAND = '#17513c';
const GOLD = '#c9982f';
const INK = '#1b2822';
const OAT = '#8d8062';
const MIST = '#e6ddc9';

/** The id every crest attachment uses. One image per message, so a fixed value is enough. */
const CREST_CID = 'school-crest';

/**
 * Formats worth embedding.
 *
 * WebP is an accepted upload type but is deliberately absent: Outlook on Windows renders nothing
 * for it, and there is no image library in this app to convert with. A school whose crest is WebP
 * falls back to the initials mark, which is a lettermark rather than a broken image icon.
 */
const EMBEDDABLE: Record<string, { ext: string; ok: true } | undefined> = {
  png: { ext: 'png', ok: true },
  jpg: { ext: 'jpg', ok: true },
  jpeg: { ext: 'jpg', ok: true },
};

/**
 * Turn a stored crest into an embeddable attachment, or decline.
 *
 * Takes the storage key rather than a content type because `storage().get()` returns bytes only;
 * the key carries the extension `objectKey()` derived from the original upload.
 */
export function crestAttachment(storageKey: string, bytes: Buffer): InlineImage | null {
  const ext = (storageKey.split('.').pop() ?? '').toLowerCase();
  const match = EMBEDDABLE[ext];
  if (!match) return null;
  // An empty object would attach a zero-byte image and render as a broken frame.
  if (!bytes.length) return null;
  return { id: CREST_CID, filename: `crest.${match.ext}`, content: bytes };
}

/** Up to two initials, matching the `SchoolCrest` component's fallback exactly. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/**
 * The mark at the top of a message: EYO's own for vendor mail, the school's for school mail.
 *
 * Which one is not a style choice. An invitation is EYO speaking to someone who has no school
 * yet — there is nothing of theirs to show. A reset or a sign-in code is the *school* speaking to
 * its own staff and families, and a guardian who has never heard of EYO should recognise their
 * child's school at a glance.
 */
export type Brandmark =
  { kind: 'eyo' } | { kind: 'school'; name: string; crest: InlineImage | null };

function mastheadHtml(mark: Brandmark): string {
  if (mark.kind === 'eyo') {
    /**
     * Typographic, because this product has no logo file — the brand is Fraunces in gold, and
     * inventing a raster mark here would create a second, unofficial one. Webfonts do not load
     * in most email clients, so the serif stack degrades to Georgia, which is what the portal's
     * own `--font-display` already falls back to.
     */
    return `<tr><td style="padding-bottom:24px;">
      <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:26px;letter-spacing:3px;color:${GOLD};line-height:1;">EYO</p>
      <p style="margin:6px 0 0;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${OAT};">School Management</p>
    </td></tr>`;
  }

  const safeName = escapeHtml(mark.name);
  const badge = mark.crest
    ? // width/height as attributes as well as CSS: Outlook ignores the style block on <img>.
      `<img src="cid:${CREST_CID}" alt="${safeName}" width="52" height="52" style="display:block;width:52px;height:52px;border:0;border-radius:8px;object-fit:contain;" />`
    : `<span style="display:inline-block;width:52px;height:52px;line-height:52px;text-align:center;background:${BRAND};color:#fffdf3;border-radius:8px;font-size:18px;font-weight:600;">${escapeHtml(initialsOf(mark.name))}</span>`;

  return `<tr><td style="padding-bottom:24px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:12px;vertical-align:middle;">${badge}</td>
      <td style="vertical-align:middle;">
        <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:17px;color:${INK};line-height:1.3;">${safeName}</p>
      </td>
    </tr></table>
  </td></tr>`;
}

/**
 * Shared shell for every message.
 *
 * Table-based and inline-styled because that is what Outlook renders. `max-width` with a centred
 * table is the layout that survives both desktop clients and the narrow phone screens most
 * Ghanaian guardians read mail on.
 */
function layout(opts: {
  mark: Brandmark;
  heading: string;
  bodyHtml: string;
  footer?: string;
}): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3ecdd;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3ecdd;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fffdf3;border-radius:12px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK};">
        ${mastheadHtml(opts.mark)}
        <tr><td>
          <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:${BRAND};">${opts.heading}</h1>
          ${opts.bodyHtml}
          <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid ${MIST};font-size:12px;color:${OAT};">
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
    <a href="${safe}" style="display:inline-block;background:${BRAND};color:#fffdf3;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">${escapeHtml(label)}</a>
  </p>
  <p style="margin:16px 0;font-size:13px;color:${OAT};word-break:break-all;">
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
      mark: { kind: 'eyo' },
      heading: 'Your school is ready to set up',
      bodyHtml: `
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">EYO has invited you to set up <strong>${school}</strong> on EYO School Management.</p>
        <p style="margin:0;font-size:15px;line-height:1.6;">Follow the link below to create your owner account and get started.</p>
        ${button(opts.acceptUrl, 'Set up my school')}
        <p style="margin:0;font-size:13px;color:${OAT};line-height:1.6;">This invitation expires on ${escapeHtml(expires)} and can only be used by this email address. If you were not expecting it, you can ignore this message.</p>`,
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
  /** The school's crest, already loaded and vetted by `crestAttachment`. */
  crest?: InlineImage | null;
}): RenderedEmail {
  const first = escapeHtml(opts.name.split(' ')[0] || 'there');
  const school = escapeHtml(opts.schoolName);
  return {
    subject: `Reset your ${opts.schoolName} password`,
    html: layout({
      mark: { kind: 'school', name: opts.schoolName, crest: opts.crest ?? null },
      heading: 'Reset your password',
      bodyHtml: `
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Hello ${first},</p>
        <p style="margin:0;font-size:15px;line-height:1.6;">Someone asked to reset the password for your <strong>${school}</strong> account. Choose a new one using the link below.</p>
        ${button(opts.resetUrl, 'Choose a new password')}
        <p style="margin:0;font-size:13px;color:${OAT};line-height:1.6;">This link expires in ${opts.expiresInMinutes} minutes and can be used once. If you did not ask for this, ignore this email — your password will not change, and signing in normally cancels the request.</p>`,
      footer: `${school} &middot; sent by EYO School Management`,
    }),
    text: `Hello ${opts.name.split(' ')[0] || 'there'},

Someone asked to reset the password for your ${opts.schoolName} account. Choose a new one here:

${opts.resetUrl}

This link expires in ${opts.expiresInMinutes} minutes and can be used once. If you did not ask for this, ignore this email — your password will not change, and signing in normally cancels the request.

${opts.schoolName}, sent by EYO School Management`,
    inlineImages: opts.crest ? [opts.crest] : undefined,
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
  /** The school's crest, already loaded and vetted by `crestAttachment`. */
  crest?: InlineImage | null;
}): RenderedEmail {
  const school = escapeHtml(opts.schoolName);
  return {
    subject: `${opts.code} is your ${opts.schoolName} sign-in code`,
    html: layout({
      mark: { kind: 'school', name: opts.schoolName, crest: opts.crest ?? null },
      heading: 'Your sign-in code',
      bodyHtml: `
        <p style="margin:0;font-size:15px;line-height:1.6;">Use this code to sign in to the <strong>${school}</strong> guardian portal.</p>
        ${codeBlock(opts.code)}
        <p style="margin:0;font-size:13px;color:${OAT};line-height:1.6;">It expires in ${opts.ttlMinutes} minutes. Never share it — ${school} will never ask you for this code.</p>`,
      footer: `${school} &middot; sent by EYO School Management`,
    }),
    text: `${opts.code} is your ${opts.schoolName} guardian portal sign-in code.

It expires in ${opts.ttlMinutes} minutes. Never share it — ${opts.schoolName} will never ask you for this code.

${opts.schoolName}, sent by EYO School Management`,
    inlineImages: opts.crest ? [opts.crest] : undefined,
  };
}
