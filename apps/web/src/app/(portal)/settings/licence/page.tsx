'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, useAsyncAction } from '@/components/Button';
import { AlertIcon, KeyIcon, SaveIcon } from '@/components/icons';

interface LicenceView {
  state: 'VALID' | 'GRACE' | 'EXPIRED' | 'MISSING' | 'INVALID';
  tier: string;
  studentCap: number | null;
  extraEntitlements: string[];
  daysRemaining: number | null;
  reason: string | null;
  usingDevKey: boolean;
  reporting: {
    enabled: boolean;
    lastAt: string | null;
    lastOk: boolean | null;
    lastDetail: string | null;
    sends: string[];
  };
  licence: {
    licenceId: string;
    schoolName: string;
    schoolSlug: string;
    issuedAt: string;
    expiresAt: string;
    graceDays: number;
  } | null;
}

/**
 * How each state reads on screen.
 *
 * GRACE is amber rather than red on purpose: everything still works, and colouring it as a
 * failure would teach people to ignore the banner that actually matters a month later.
 */
const TONE: Record<LicenceView['state'], { label: string; cls: string }> = {
  VALID: { label: 'Active', cls: 'bg-leaf/10 text-leaf' },
  GRACE: { label: 'Expired — in grace', cls: 'bg-clay/10 text-clay' },
  EXPIRED: { label: 'Expired', cls: 'bg-danger/10 text-danger' },
  MISSING: { label: 'Not installed', cls: 'bg-parchment text-oat' },
  INVALID: { label: 'Not valid', cls: 'bg-danger/10 text-danger' },
};

const date = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

export default function LicencePage() {
  const [view, setView] = useState<LicenceView | null>(null);
  const [licence, setLicence] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/proxy/licence');
    if (res.ok) setView(await res.json());
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const install = useAsyncAction(async () => {
    setError(null);
    const res = await fetch('/api/proxy/licence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licence: licence.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message ?? 'That licence could not be installed.');
      throw new Error('rejected');
    }
    setLicence('');
    load();
  });

  const tone = view ? TONE[view.state] : null;

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Licence</h1>
        <p className="text-sm text-oat mt-1.5">
          Your licence sets which features this school has and how many students it may enrol. It is
          checked on this server, so it keeps working with no internet at all.
        </p>
      </div>

      <div className="card p-6 mt-6 rise rise-2 max-w-2xl">
        {!view ? (
          <p className="text-sm text-oat">Loading…</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h2 className="font-display text-xl">
                  {view.licence?.schoolName ?? 'No licence installed'}
                </h2>
                {view.licence && (
                  <p className="text-xs text-oat mt-1 tabular">Licence {view.licence.licenceId}</p>
                )}
              </div>
              {tone && (
                <span
                  className={`text-[11px] uppercase tracking-wider rounded-full px-2.5 py-1 ${tone.cls}`}
                >
                  {tone.label}
                </span>
              )}
            </div>

            {/*
              The reason is the whole point of this screen when something is wrong — an expiry
              date alone does not tell someone whether they can still enrol a child today.
            */}
            {view.reason && (
              <p
                className={`mt-4 text-sm flex gap-2 ${view.state === 'GRACE' ? 'text-clay' : 'text-danger'}`}
              >
                <AlertIcon aria-hidden />
                <span>{view.reason}</span>
              </p>
            )}

            <dl className="mt-5 grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-oat text-xs uppercase tracking-widest">Package</dt>
                <dd className="mt-0.5 font-medium">{view.tier}</dd>
              </div>
              <div>
                <dt className="text-oat text-xs uppercase tracking-widest">Student limit</dt>
                <dd className="mt-0.5 font-medium tabular">{view.studentCap ?? 'Unlimited'}</dd>
              </div>
              {view.licence && (
                <>
                  <div>
                    <dt className="text-oat text-xs uppercase tracking-widest">Expires</dt>
                    <dd className="mt-0.5 font-medium">
                      {date(view.licence.expiresAt)}
                      {view.daysRemaining !== null && view.daysRemaining >= 0 && (
                        <span className="text-oat font-normal"> · {view.daysRemaining} days</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-oat text-xs uppercase tracking-widest">Issued</dt>
                    <dd className="mt-0.5 font-medium">{date(view.licence.issuedAt)}</dd>
                  </div>
                </>
              )}
            </dl>

            {view.extraEntitlements.length > 0 && (
              <div className="mt-5">
                <p className="text-oat text-xs uppercase tracking-widest">Also included</p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {view.extraEntitlements.map((code) => (
                    <li
                      key={code}
                      className="text-[11px] rounded-full bg-gold-soft/60 text-gold px-2 py-0.5 tabular"
                    >
                      {code}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/*
              Only shown when it is true, and it is true on every developer machine. Silence here
              is the signal that a real vendor key is configured.
            */}
            {view.usingDevKey && (
              <p className="mt-5 text-xs text-clay flex gap-2 border-t border-mist pt-4">
                <AlertIcon aria-hidden />
                <span>
                  This server is checking licences against the built-in development key. Set
                  LICENCE_PUBLIC_KEY before going live.
                </span>
              </p>
            )}
          </>
        )}
      </div>

      {/*
        Shown whether reporting is on or off, and off is the default.

        A product that sells on keeping a school's data on the school's own server has to be able
        to answer "does it phone home, and with what?" precisely. Leaving this out — or only
        mentioning it when enabled — would make the claim unverifiable, which is the same as
        asking to be taken on trust.
      */}
      <section className="card p-6 mt-6 rise rise-3 max-w-2xl">
        <h2 className="font-display text-xl">Reporting to your supplier</h2>
        {view?.reporting.enabled ? (
          <>
            <p className="text-sm text-oat mt-1.5">
              Once a day this server sends your supplier a short summary of this licence. It never
              sends anything about a student, a guardian or a member of staff, and it has no say in
              what the school can do — if it never gets through, nothing changes.
            </p>
            <dl className="mt-4 text-sm">
              <div>
                <dt className="text-oat text-xs uppercase tracking-widest">Last reported</dt>
                <dd className="mt-0.5 font-medium">
                  {view.reporting.lastAt
                    ? new Date(view.reporting.lastAt).toLocaleString()
                    : 'Not yet'}
                  {view.reporting.lastOk === false && (
                    <span className="text-oat font-normal"> · did not get through</span>
                  )}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-oat text-xs uppercase tracking-widest">Everything it sends</p>
            <ul className="mt-1.5 space-y-1 text-sm text-oat list-disc pl-5">
              {view.reporting.sends.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-oat mt-1.5">
            Off. This server does not contact your supplier at all — your licence is checked here,
            on this machine, and nothing about your school leaves it.
          </p>
        )}
      </section>

      <form onSubmit={install.run} className="card p-6 mt-6 rise rise-4 max-w-2xl space-y-4">
        <div>
          <h2 className="font-display text-xl flex items-center gap-2">
            <KeyIcon aria-hidden />
            Install a licence
          </h2>
          <p className="text-sm text-oat mt-1.5">
            Paste the licence your supplier sent you. Replacing a licence takes effect immediately —
            you do not need to restart anything.
          </p>
        </div>

        <label className="block">
          <span className="text-xs uppercase tracking-widest text-oat">Licence text</span>
          <textarea
            value={licence}
            onChange={(e) => setLicence(e.target.value)}
            rows={5}
            spellCheck={false}
            required
            placeholder="eyJ2IjoxLCJsaWNlbmNlSWQiOi…"
            className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2 text-xs font-mono break-all focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-danger flex gap-2">
            <AlertIcon aria-hidden />
            <span>{error}</span>
          </p>
        )}

        <Button
          type="submit"
          state={install.state}
          disabled={!licence.trim()}
          pendingLabel="Checking…"
          doneLabel="Installed!"
          failedLabel="Not valid"
          icon={<SaveIcon aria-hidden />}
        >
          Install licence
        </Button>
      </form>
    </div>
  );
}
