import { redirect } from 'next/navigation';
import { emailFactorAvailable } from '@/lib/mfa';
import { isEnrolled } from '@/lib/mfa-policy';
import { pendingUser } from '@/lib/session';
import ChallengeForm from './ChallengeForm';

export const dynamic = 'force-dynamic';

/**
 * The second factor, between a correct password and the portal.
 *
 * Reached only with a pending session. Somebody who is not enrolled is sent to set up rather than
 * past this — there is no branch here that ends in a signed-in session without a factor.
 */
export default async function MfaPage() {
  const user = await pendingUser();
  if (!user) redirect('/login');
  if (!isEnrolled(user)) redirect('/mfa/setup');

  return (
    <main className="min-h-dvh grid place-items-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <img src="/brand/klasio-lockup.png" alt="Klasio" className="h-10 w-auto mx-auto" />
          <p className="mt-4 text-sm text-slate">Signing in as {user.email}</p>
        </div>

        <div className="card p-7 mt-6">
          <ChallengeForm canEmail={emailFactorAvailable()} />
        </div>

        <p className="mt-4 text-center text-xs text-oat">
          <a href="/login" className="underline underline-offset-2">
            Sign in as somebody else
          </a>
        </p>
      </div>
    </main>
  );
}
