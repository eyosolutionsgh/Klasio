/**
 * Calling the vendor console's API from the browser.
 *
 * The console is client-rendered, so unlike `lib/api.ts` (server components, `redirect()`) this
 * has to bounce the browser itself when the session goes. Kept in one place so every screen in
 * the console fails the same way rather than each inventing its own handling.
 */

/** Thrown after a redirect has already been started; callers should stop, not report it. */
export const SIGNED_OUT = 'signed out';

export async function platformCall<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/platform/platform/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status === 401) {
    window.location.href = '/platform/login';
    throw new Error(SIGNED_OUT);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string }).message ?? 'That did not work');
  return data as T;
}

/** True for the error above, so callers can stay quiet while the redirect happens. */
export const isSignedOut = (e: unknown) => (e as Error)?.message === SIGNED_OUT;

export const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });
