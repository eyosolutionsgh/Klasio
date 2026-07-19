'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import type { LicenceTier } from '@eyo/shared';
import { db } from './db';
import { issueLicence } from './issue';
import { currentUser, mintSession, SESSION_COOKIE } from './session';

export async function signIn(_prev: string | null, form: FormData): Promise<string | null> {
  const email = String(form.get('email') ?? '')
    .toLowerCase()
    .trim();
  const password = String(form.get('password') ?? '');
  const user = await db.vendorUser.findUnique({ where: { email } });

  // One message for both cases: which of the two was wrong is not the sign-in page's business.
  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
    return 'Those details were not recognised.';
  }

  await db.vendorUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const session = mintSession(user.id);
  (await cookies()).set(session.name, session.value, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: session.maxAge,
    secure: process.env.NODE_ENV === 'production',
  });
  redirect('/');
}

export async function signOut() {
  (await cookies()).set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  redirect('/login');
}

export async function addClient(_prev: string | null, form: FormData): Promise<string | null> {
  const user = await currentUser();
  if (!user) redirect('/login');

  const name = String(form.get('name') ?? '').trim();
  const slug = String(form.get('slug') ?? '')
    .trim()
    .toLowerCase();

  if (name.length < 2) return 'Give the school a name.';
  /*
    The slug is the licence binding, so it is validated hard here rather than tidied up.
    Auto-correcting it would be worse than refusing: a licence issued against a slug the vendor
    invented will not install, and the school is the one who finds out.
  */
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return 'The slug must be lowercase letters, numbers and single hyphens — and must match exactly what the school’s own server uses.';
  }
  if (await db.client.findUnique({ where: { slug } })) {
    return 'A client already uses that slug.';
  }

  const client = await db.client.create({
    data: {
      name,
      slug,
      contactName: String(form.get('contactName') ?? '').trim() || null,
      contactEmail: String(form.get('contactEmail') ?? '').trim() || null,
      contactPhone: String(form.get('contactPhone') ?? '').trim() || null,
    },
  });

  /*
    Claim the reports that arrived before the client existed.

    A school's server usually starts reporting the moment it is installed, which is often before
    anyone has added it here. Without this the new client shows "no reports yet" while its history
    sits in the unknown-schools panel — the same data, filed under a stranger.
  */
  await db.heartbeat.updateMany({
    where: { clientId: null, schoolSlug: slug },
    data: { clientId: client.id },
  });

  revalidatePath('/');
  return null;
}

export async function issue(_prev: string | null, form: FormData): Promise<string | null> {
  const user = await currentUser();
  if (!user) redirect('/login');

  const clientId = String(form.get('clientId') ?? '');
  const tier = String(form.get('tier') ?? 'MEDIUM') as LicenceTier;
  const months = Number(form.get('months') ?? 12);
  const capRaw = String(form.get('studentCap') ?? '').trim();

  try {
    await issueLicence({
      clientId,
      tier,
      months,
      // Blank means "whatever the package says"; "unlimited" is the explicit no-ceiling case, and
      // the two must stay distinguishable — null in a payload means unlimited, not unspecified.
      studentCap:
        capRaw === '' ? undefined : capRaw.toLowerCase() === 'unlimited' ? null : Number(capRaw),
      extraEntitlements: String(form.get('extras') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      graceDays: Number(form.get('graceDays') ?? 30),
      issuedById: user.id,
    });
  } catch (e) {
    return e instanceof Error ? e.message : 'Could not issue that licence.';
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/');
  return null;
}
