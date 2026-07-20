'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { issueLicence } from './issue';
import { archivePackage, createPackage, updatePackage } from './packages';
import { DEFAULT_TERM } from './terms';
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
    return 'Use lowercase letters, numbers and single hyphens, exactly as the school’s own server has it.';
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
  const packageId = String(form.get('packageId') ?? '');
  const term = String(form.get('term') ?? DEFAULT_TERM);

  if (!packageId) return 'Choose a package to issue.';

  try {
    await issueLicence({
      clientId,
      packageId,
      term,
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

/**
 * Withdraw a licence.
 *
 * **This does not reach the school.** Their server holds the signed file and checks it locally, on
 * purpose — that is what lets a school in a place with no reliable internet keep working. Nothing
 * here can take it back. What this does is make the vendor's own record true: the licence stops
 * counting as the one in force, so the client reads as unlicensed and the next renewal is priced
 * against reality rather than against a refunded sale.
 *
 * To actually stop a school, issue a shorter licence they will install, or wait for expiry. Saying
 * so on screen matters more than saying it here — a supplier who believes they have cut somebody
 * off, and has not, finds out from the customer.
 *
 * The row survives, marked. Deleting it would erase what was sent to a school, which is the one
 * thing support cannot reconstruct from anywhere else.
 */
export async function revoke(_prev: string | null, form: FormData): Promise<string | null> {
  const user = await currentUser();
  if (!user) redirect('/login');

  const id = String(form.get('licenceId') ?? '');
  const reason = String(form.get('reason') ?? '').trim();

  // A reason is required because it is the whole value of the record. "Withdrawn" with no cause,
  // read a year later by someone else, is indistinguishable from a mistake.
  if (reason.length < 4) return 'Say why this licence is being withdrawn.';

  const licence = await db.licence.findUnique({ where: { id } });
  if (!licence) return 'That licence no longer exists.';
  if (licence.revokedAt) return 'That licence was already withdrawn.';

  await db.licence.update({
    where: { id },
    data: { revokedAt: new Date(), revokedReason: reason, revokedById: user.id },
  });

  revalidatePath(`/clients/${licence.clientId}`);
  revalidatePath('/');
  return null;
}

/**
 * Build or edit a package.
 *
 * One action for both, because the form is the same and the difference is a hidden id. Editing
 * never touches a licence already issued — those froze their own copy of the feature list, which
 * is what keeps "what did this school pay for" answerable after a product is repriced.
 */
export async function savePackage(_prev: string | null, form: FormData): Promise<string | null> {
  const user = await currentUser();
  if (!user) redirect('/login');

  const id = String(form.get('id') ?? '');
  const input = {
    name: String(form.get('name') ?? ''),
    description: String(form.get('description') ?? ''),
    tier: String(form.get('tier') ?? 'MEDIUM') as 'BASIC' | 'MEDIUM' | 'ADVANCED',
    // getAll: one entry per ticked box. `get` would keep only the first feature in the package.
    entitlements: form.getAll('entitlements').map(String).filter(Boolean),
  };

  try {
    if (id) await updatePackage(id, input);
    else await createPackage(input);
  } catch (e) {
    return e instanceof Error ? e.message : 'Could not save that package.';
  }
  revalidatePath('/packages');
  return null;
}

/** Withdraw a package from sale, or put it back. Never a delete — licences point at it. */
export async function setPackageArchived(
  _prev: string | null,
  form: FormData,
): Promise<string | null> {
  const user = await currentUser();
  if (!user) redirect('/login');

  try {
    await archivePackage(String(form.get('id') ?? ''), form.get('archived') === 'true');
  } catch (e) {
    return e instanceof Error ? e.message : 'Could not change that package.';
  }
  revalidatePath('/packages');
  return null;
}
