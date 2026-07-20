import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Whether this server has no school yet.
 *
 * Fails to `false`, the same direction /api/setup answers in. An unreachable API does not mean
 * setup is needed, and sending an existing school's staff to a form that will refuse them is a
 * worse dead end than the sign-in page they were expecting.
 */
async function needsSetup(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/public/setup/state`, { cache: 'no-store' });
    if (!res.ok) return false;
    const state = (await res.json()) as { needsSetup?: boolean };
    return state.needsSetup === true;
  } catch {
    return false;
  }
}

export default async function Home() {
  const jar = await cookies();
  if (jar.get('eyo_token')) redirect('/dashboard');

  // A fresh install has no school and therefore no account that could ever sign in, so /login is a
  // dead end until someone thinks to type /setup. Only signed-out visitors reach this, and /setup
  // closes itself permanently once a school exists, so a configured server never lands here twice.
  if (await needsSetup()) redirect('/setup');

  redirect('/login');
}
