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

/** Mask for display/logs: 233241234567 → 233 24 *** 4567 */
export function maskMsisdn(msisdn: string): string {
  if (msisdn.length < 6) return '***';
  return `${msisdn.slice(0, 5)} *** ${msisdn.slice(-4)}`;
}
