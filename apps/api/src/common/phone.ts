/**
 * Ghana MSISDN normalisation, shared by bulk SMS and guardian sign-in.
 *
 * Guardians type their number every way imaginable (024…, +233 24…, 233-24…), and guardian
 * login matches on it, so normalisation has to be identical on both sides — otherwise a
 * guardian whose number was stored one way could never sign in typing it another way.
 */
export function normalizeMsisdn(raw: string): string | null {
  const digits = (raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;
  if (digits.startsWith('233')) return digits;
  if (digits.startsWith('0')) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits;
}

/**
 * Mask for display and logs: `233241234567` → `024 *** 6410`.
 *
 * Rendered the way the owner writes it — a leading zero and no country code — because this is now
 * shown to a parent choosing which phone to pick up, not only written to a log. Stored numbers are
 * normalised to `233…` (see `normalizeMsisdn`), and `23324 *** 6410` is not a form any Ghanaian
 * recognises as their own number at a glance. Anything not on the Ghanaian country code is left
 * as it is rather than guessing at its national format.
 */
export function maskMsisdn(msisdn: string): string {
  if (msisdn.length < 6) return '***';
  const local = msisdn.startsWith('233') ? `0${msisdn.slice(3)}` : msisdn;
  // A number too short to keep a distinct prefix and last four would overlap the two.
  if (local.length < 7) return '***';
  return `${local.slice(0, 3)} *** ${local.slice(-4)}`;
}
