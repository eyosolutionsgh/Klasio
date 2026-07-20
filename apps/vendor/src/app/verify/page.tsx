import { redirect } from 'next/navigation';
import { emailFactorAvailable } from '@/lib/mfa';
import { pendingIdentity } from '@/lib/session';
import ChallengeForm from './ChallengeForm';

export const dynamic = 'force-dynamic';

/**
 * The code that signs somebody in.
 *
 * Rendered from the address typed on the previous screen and nothing else — not from an account,
 * because there may not be one. An address with no staff account reaches exactly this page, is
 * offered exactly these options, and fails on exactly the same sentence as a wrong code. The page
 * cannot say who is staff because it does not know.
 */
export default async function VerifyPage() {
  const email = await pendingIdentity();
  if (!email) redirect('/login');

  return (
    <main className="min-h-dvh grid place-items-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <img src="/brand/klasio-lockup.png" alt="Klasio" className="h-10 w-auto mx-auto" />
          <p className="mt-4 text-sm text-slate">Signing in as {email}</p>
        </div>

        <div className="card p-7 mt-6">
          <ChallengeForm canEmail={emailFactorAvailable()} />
        </div>

        <p className="mt-4 text-center text-xs text-oat">
          <a href="/login" className="underline underline-offset-2">
            Use a different address
          </a>
        </p>
      </div>
    </main>
  );
}
