'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { db } from './db';
import { issueLicence } from './issue';
import { archivePackage, createPackage, updatePackage } from './packages';
import { DEFAULT_TERM } from './terms';
import {
  currentUser,
  mintPendingSession,
  mintSession,
  PENDING_SESSION_COOKIE,
  pendingIdentity,
  pendingUser,
  SESSION_COOKIE,
} from './session';
import {
  confirmEnrolment,
  emailFactorAvailable,
  sendEmailCode,
  verifySecondFactor,
  type MfaFactor,
} from './mfa';

/**
 * Step one: an address, and nothing else.
 *
 * There is no password. What signs somebody in is a code — emailed, or from their authenticator —
 * so this step is a *claim*, not a check, and it must behave identically for an address with no
 * account behind it. Refusing here, or taking a visibly different path, would turn the sign-in
 * page into a way of asking which addresses are staff.
 *
 * A code is sent immediately when the account exists and mail is configured, because the common
 * case is somebody who wants one; the screen offers the authenticator instead for anyone who has
 * it.
 */
export async function signIn(_prev: string | null, form: FormData): Promise<string | null> {
  const email = String(form.get('email') ?? '')
    .toLowerCase()
    .trim();
  if (!email) return 'Enter your email address.';

  await setCookie(mintPendingSession(email));

  // Best effort, and its outcome is never reported: whether a code was sent is exactly the fact
  // that must not leak. A failure to send shows up on the next screen as a code that never comes.
  const user = await db.vendorUser.findUnique({ where: { email } });
  if (user?.active) await sendEmailCode(user.id).catch(() => undefined);

  redirect('/verify');
}

async function setCookie(c: { name: string; value: string; maxAge: number }) {
  (await cookies()).set(c.name, c.value, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: c.maxAge,
    secure: process.env.NODE_ENV === 'production',
  });
}

/** Exchange a pending session for a real one, having proved a second factor. */
async function completeSignIn(userId: string) {
  await setCookie(mintSession(userId));
  (await cookies()).set(PENDING_SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

/**
 * Step two: the code that actually signs somebody in.
 *
 * An address with no account fails here exactly as a wrong code does, and takes the same path to
 * get there — the check runs against a real row or it does not run at all, and either way the
 * answer is the same sentence.
 */
export async function verifyMfa(_prev: string | null, form: FormData): Promise<string | null> {
  const email = await pendingIdentity();
  if (!email) redirect('/login');

  const user = await pendingUser();
  if (!user) return GENERIC_CODE_FAILURE;

  const factor = String(form.get('factor') ?? 'email') as MfaFactor;
  const result = await verifySecondFactor(user.id, factor, String(form.get('code') ?? ''));
  if (!result.ok) return result.error ?? GENERIC_CODE_FAILURE;

  await completeSignIn(user.id);
  redirect('/');
}

/** One sentence for "no such account" and for "wrong code", so neither can be told from the other. */
const GENERIC_CODE_FAILURE = 'That code did not match.';

/**
 * Send another code.
 *
 * Reports only what is true regardless of the account: a cooldown, or a server that cannot send
 * mail at all. Whether *this* address received one is never said, because that is the fact worth
 * protecting.
 */
export async function requestEmailCode(
  _prev: string | null,
  _form: FormData,
): Promise<string | null> {
  const email = await pendingIdentity();
  if (!email) redirect('/login');
  if (!emailFactorAvailable()) return 'This server cannot send email.';

  const user = await db.vendorUser.findUnique({ where: { email } });
  if (!user?.active) return null;

  const result = await sendEmailCode(user.id);
  // A cooldown is worth saying — it is about the button, not about the account.
  return result.ok ? null : (result.error ?? null);
}

/**
 * Finish enrolment, and stop.
 *
 * Deliberately does **not** sign in. Completing the session here clears the pending cookie, the
 * page re-renders after the action, finds nobody part-way through signing in, and redirects to the
 * login screen — carrying the recovery codes away with it. They exist in readable form exactly
 * once, so the screen that shows them has to outlive the action that produced them.
 */
/**
 * Add an authenticator to an account that is already signed in.
 *
 * Enrolment moved behind a real session when the password went. Sign-in needs one code, not two,
 * so an authenticator is something a member of staff chooses to add — and letting somebody set one
 * up from a half-finished sign-in would mean an emailed code could quietly plant a new way in.
 */
export async function completeEnrolment(
  _prev: EnrolmentResult,
  form: FormData,
): Promise<EnrolmentResult> {
  const user = await currentUser();
  if (!user) redirect('/login');

  const result = await confirmEnrolment(user.id, String(form.get('code') ?? ''));
  if (!result.ok) return { error: result.error ?? 'That code did not match.' };
  return { recoveryCodes: result.recoveryCodes };
}

export interface EnrolmentResult {
  error?: string;
  recoveryCodes?: string[];
}

export async function signOut() {
  const jar = await cookies();
  // Both, so signing out part-way through a challenge does not leave a usable pending session.
  jar.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  jar.set(PENDING_SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
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
