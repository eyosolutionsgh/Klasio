import QRCode from 'qrcode';
import { beginEnrolment } from '@/lib/mfa';
import { requireUser } from '@/lib/session';
import Header from '../Header';
import EnrolForm from './EnrolForm';

export const dynamic = 'force-dynamic';

/**
 * Adding an authenticator app to your own account.
 *
 * Behind a real session, not a half-finished sign-in. Signing in takes one code now, so an
 * authenticator is something a member of staff chooses to add — and letting one be set up from a
 * pending sign-in would mean an emailed code could quietly plant a second, permanent way in.
 */
export default async function SecurityPage() {
  const user = await requireUser();
  const enrolled = user.totpConfirmedAt !== null;

  const setup = enrolled ? null : await beginEnrolment(user.id, user.email);
  const qr = setup ? await QRCode.toDataURL(setup.uri, { margin: 1, width: 220 }) : null;

  return (
    <>
      <Header />
      <main className="max-w-lg mx-auto px-6 py-8">
        <h1 className="text-xl font-semibold">Signing in</h1>
        <p className="text-sm text-slate mt-0.5">
          How you get into this portal, on this account ({user.email}).
        </p>

        <section className="card p-6 mt-6">
          <h2 className="text-base font-semibold">Authenticator app</h2>

          {enrolled ? (
            <>
              <p className="text-sm text-slate mt-1">
                Set up. You can sign in with a code from your app instead of waiting for email —
                which also works when this server cannot send mail, or you cannot reach your inbox.
              </p>
              {/*
                No "remove" here on purpose. Taking a way in away from an account is a support
                decision, not a button, and somebody who has lost the app wants a recovery code
                rather than to be locked out faster.
              */}
              <p className="text-xs text-oat mt-3">
                To replace it — a new phone, say — ask another member of staff to clear it for you.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-slate mt-1">
                Optional, and worth it: a code from an app arrives instantly and needs no inbox.
              </p>
              <ol className="text-sm space-y-4 mt-5">
                <li>
                  <span className="font-medium">1. Scan this</span> with Google Authenticator,
                  1Password, Authy or any app that takes a QR code.
                  <div className="mt-3 flex justify-center">
                    {/* A data URI, so nothing is fetched and the secret reaches no third party. */}
                    <img
                      src={qr!}
                      alt=""
                      width={220}
                      height={220}
                      className="rounded border border-mist"
                    />
                  </div>
                  <p className="text-xs text-oat mt-2 text-center">
                    No camera? Type this key instead:
                    <br />
                    <span className="font-mono text-[13px] text-slate select-all">
                      {setup!.readable}
                    </span>
                  </p>
                </li>
                <li>
                  <span className="font-medium">2. Enter the six digits it shows.</span>
                  <EnrolForm />
                </li>
              </ol>
            </>
          )}
        </section>
      </main>
    </>
  );
}
