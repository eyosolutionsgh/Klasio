/**
 * Masks for contact details echoed back to someone who has not yet proved who they are.
 *
 * The guardian sign-in page shows where a code was sent so a parent with two numbers knows which
 * phone to pick up. That means these strings are shown *before* the code is verified, so they must
 * carry enough to recognise a contact you already own and not enough to learn one you do not.
 */

/**
 * `ama.mensah@example.com` → `a***h@example.com`.
 *
 * The domain stays whole: it is rarely the secret (most families are on one of a handful of
 * providers) and hiding it would leave nothing recognisable at all. The local part keeps only its
 * first and last character, which is enough for "yes, that is my address" and not enough to
 * reconstruct one.
 */
export function maskEmail(raw: string): string {
  const email = (raw ?? '').trim();
  const at = email.lastIndexOf('@');
  // Not an address we can split — mask the whole thing rather than echoing it back verbatim.
  if (at <= 0 || at === email.length - 1) return '***';

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (local.length === 1) return `***@${domain}`;
  if (local.length === 2) return `${local[0]}***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}
