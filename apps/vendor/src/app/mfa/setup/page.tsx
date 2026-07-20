import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { beginEnrolment } from '@/lib/mfa';
import { isEnrolled } from '@/lib/mfa-policy';
import { pendingUser } from '@/lib/session';
import EnrolForm from './EnrolForm';

export const dynamic = 'force-dynamic';

/**
 * Setting up a second factor, which nobody may skip.
 *
 * Reached only with a pending session — a correct password and nothing more. That is what makes
 * "required" true rather than merely encouraged: there is no route from here to the portal that
 * does not pass through proving the secret works.
 */
export default async function MfaSetupPage() {
  const user = await pendingUser();
  if (!user) redirect('/login');
  // Already enrolled: this is the challenge, not setup. Re-enrolling from here would let anyone
  // holding a password replace the second factor, which would be no second factor at all.
  if (isEnrolled(user)) redirect('/mfa');

  const { uri, readable } = await beginEnrolment(user.id, user.email);
  // Rendered on the server into a data URI: the page loads no third-party script and the secret
  // never travels to one.
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });

  return (
    <main className="min-h-dvh grid place-items-center px-6 py-10">
      <div className="w-full max-w-lg">
        <div className="text-center">
          <img src="/brand/klasio-lockup.png" alt="Klasio" className="h-10 w-auto mx-auto" />
          <h1 className="mt-5 text-lg font-semibold">Set up your authenticator</h1>
          <p className="text-sm text-slate mt-1.5">
            This portal can issue a licence for any school, so a password on its own is not enough
            to get in.
          </p>
        </div>

        <div className="card p-7 mt-6">
          <ol className="text-sm space-y-4">
            <li>
              <span className="font-medium">1. Scan this</span> with Google Authenticator,
              1Password, Authy or any app that takes a QR code.
              <div className="mt-3 flex justify-center">
                {/* A data URI, so nothing is fetched and the optimiser has nothing to do. */}
                <img
                  src={qr}
                  alt=""
                  width={220}
                  height={220}
                  className="rounded border border-mist"
                />
              </div>
              <p className="text-xs text-oat mt-2 text-center">
                No camera? Type this key instead:
                <br />
                <span className="font-mono text-[13px] text-slate select-all">{readable}</span>
              </p>
            </li>
            <li>
              <span className="font-medium">2. Enter the six digits it shows.</span>
              <EnrolForm />
            </li>
          </ol>
        </div>
      </div>
    </main>
  );
}
