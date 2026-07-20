import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ENTITLEMENT_CATALOGUE } from '@eyo/shared';
import { db } from '@/lib/db';
import { sellablePackages } from '@/lib/packages';
import { assessClient } from '@/lib/issue';
import { requireUser } from '@/lib/session';
import { termLabel } from '@/lib/terms';
import { canIssue, usingDevSigningKey } from '@/lib/vendor-key';
import Header from '../../Header';
import IssueForm from './IssueForm';
import LicenceText from './LicenceText';
import RevokeLicence from './RevokeLicence';

export const dynamic = 'force-dynamic';

const when = (d: Date | null) =>
  d
    ? new Date(d).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
const day = (d: Date | null) =>
  d
    ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  // Redirects to the sign-in step they are actually at, rather than always to the start.
  await requireUser();
  const { id } = await params;

  const client = await db.client.findUnique({
    where: { id },
    include: {
      licences: { orderBy: { createdAt: 'desc' }, include: { issuedBy: true, revokedBy: true } },
      heartbeats: { orderBy: { receivedAt: 'desc' }, take: 20 },
    },
  });
  if (!client) notFound();

  const packages = await sellablePackages();

  // Neither replaced nor withdrawn — see the note on the dashboard query. Withdrawing the current
  // licence must not promote the one it replaced.
  const live = client.licences.find((l) => !l.revokedAt && !l.supersededAt) ?? null;
  const beat = client.heartbeats[0] ?? null;
  const { health, note } = assessClient({
    everIssued: client.licences.length > 0,
    licence: live ? { tier: live.tier, expiresAt: live.expiresAt } : null,
    lastBeat: beat
      ? {
          receivedAt: beat.receivedAt,
          verifiedWith: beat.verifiedWith,
          tierInForce: beat.tierInForce,
          students: beat.students,
        }
      : null,
  });

  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <Link href="/" className="text-sm text-oat hover:text-navy">
          ← All schools
        </Link>
        <header className="mt-3 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold">{client.name}</h1>
            <p className="text-sm text-oat font-mono mt-0.5">{client.slug}</p>
          </div>
          {note && <p className="text-sm text-clay max-w-sm text-right">{note}</p>}
        </header>

        {/*
        What the school's own server last said about itself — as reported, not as sold.

        Kept visually distinct from the licence panel below for that reason: one is what the vendor
        issued and knows to be true, the other is a claim from a machine the vendor does not control.
        Presenting them as one table would blur a distinction worth keeping.
      */}
        <section className="card mt-5 p-6">
          <h2 className="text-base font-medium">What the school&apos;s server reports</h2>
          {beat ? (
            <dl className="mt-4 grid sm:grid-cols-4 gap-4 text-sm">
              <div>
                <dt className="text-oat text-xs uppercase tracking-widest">Last report</dt>
                <dd className="mt-0.5">{when(beat.receivedAt)}</dd>
              </div>
              <div>
                <dt className="text-oat text-xs uppercase tracking-widest">Running</dt>
                <dd className="mt-0.5">
                  {beat.tierInForce ?? '—'}
                  {beat.state && <span className="text-oat"> · {beat.state.toLowerCase()}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-oat text-xs uppercase tracking-widest">Enrolled</dt>
                <dd className="mt-0.5 tabular-nums">{beat.students ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-oat text-xs uppercase tracking-widest">Verifies with</dt>
                <dd
                  className={`mt-0.5 ${beat.verifiedWith && beat.verifiedWith !== 'vendor' ? 'text-danger font-medium' : ''}`}
                >
                  {beat.verifiedWith ?? '—'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-oat mt-2">
              Reports arrive here once the school switches reporting on. The school runs exactly the
              same either way.
            </p>
          )}
          {client.heartbeats.length > 1 && (
            <details className="mt-4">
              <summary className="text-xs text-oat cursor-pointer">
                Recent reports ({client.heartbeats.length})
              </summary>
              <ul className="mt-2 text-xs text-oat space-y-1 font-mono">
                {client.heartbeats.map((h) => (
                  <li key={h.id}>
                    {when(h.receivedAt)} · {h.state} · {h.tierInForce} · {h.students ?? '—'}{' '}
                    students · {h.verifiedWith}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="card mt-5 p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-medium">Licences issued</h2>
            <span className="text-xs text-oat">{health}</span>
          </div>

          {client.licences.length === 0 ? (
            <p className="text-sm text-slate mt-2">The first licence issued will appear here.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {client.licences.map((l) => (
                <li
                  key={l.id}
                  /* A withdrawn licence is history rather than a mistake, so it recedes instead of
                     shouting — the red belongs on the reason, which is the part worth reading. */
                  className={`border rounded p-4 ${l.revokedAt ? 'border-mist/60 bg-hush/40' : 'border-mist'}`}
                >
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <p className="font-mono text-sm">{l.licenceId}</p>
                    <p className="text-xs text-oat">
                      {l.revokedAt
                        ? `withdrawn ${day(l.revokedAt)}`
                        : l.supersededAt
                          ? `replaced ${day(l.supersededAt)}`
                          : 'current'}
                    </p>
                  </div>
                  <p className="text-sm mt-1">
                    {/* The package as it was named when sold — it may have been renamed since. */}
                    {l.packageName ?? l.tier} · {termLabel(l.termMonths)} · {day(l.issuedAt)} –{' '}
                    {day(l.expiresAt)} · {l.graceDays}d grace
                  </p>
                  {/*
                  The features sold on top of the package. Shown as labels rather than codes: the
                  person reading this is checking an invoice, and "AI report remarks" answers that
                  where "ai.remarks" needs looking up.
                */}
                  {/*
                    What this licence actually granted, frozen at issue. `entitlements` is a
                    package; `extraEntitlements` is the older shape, kept so licences issued before
                    packages still read. Neither is recomputed — editing a product must not rewrite
                    what a school was sold.
                  */}
                  {(l.entitlements.length > 0 ? l.entitlements : l.extraEntitlements).length >
                    0 && (
                    <p className="text-sm mt-1.5">
                      <span className="text-slate">
                        {l.entitlements.length > 0 ? 'Includes ' : 'Plus '}
                      </span>
                      {(l.entitlements.length > 0 ? l.entitlements : l.extraEntitlements)
                        .map((c) => ENTITLEMENT_CATALOGUE.find((e) => e.code === c)?.label ?? c)
                        .join(', ')}
                    </p>
                  )}
                  {l.issuedBy && (
                    <p className="text-xs text-oat mt-1">Issued by {l.issuedBy.name}</p>
                  )}

                  {/*
                    Why it was withdrawn, not merely that it was. A year later this is the only
                    thing that distinguishes a refund from a mistake.
                  */}
                  {l.revokedAt && (
                    <p className="text-sm text-danger mt-1.5">
                      Withdrawn: {l.revokedReason}
                      {l.revokedBy && <span className="text-oat"> · by {l.revokedBy.name}</span>}
                    </p>
                  )}
                  {/*
                  The signed text, on demand. Kept so it can be re-sent when a school loses the
                  email — it is not a secret, the school already has it, and anyone with the public
                  key can verify it.
                */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <LicenceText signed={l.signed} licenceId={l.licenceId} />
                    {/*
                      Offered only on the licence in force. A replaced one is already out of force
                      and reads "replaced" — giving it a second, competing status would invite
                      withdrawing the wrong row while adding nothing.
                    */}
                    {l.id === live?.id && (
                      <div className="mt-3 text-xs">
                        <RevokeLicence
                          licenceId={l.id}
                          licenceRef={l.licenceId}
                          current={l.id === live?.id}
                        />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {canIssue() ? (
          <IssueForm
            clientId={client.id}
            packages={packages.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              tier: p.tier,
              entitlements: p.entitlements,
            }))}
            currentPackageId={live?.packageId ?? null}
            devKey={usingDevSigningKey()}
          />
        ) : (
          /*
            Named variables and a command, rather than "add a signing key". Someone reading this is
            trying to do the portal's main job and has just been told they cannot — the next step
            belongs on screen, not in a README they would have to know to look for.
          */
          <div className="card mt-5 px-5 py-4 text-sm text-clay">
            <p>This portal is tracking licences only. To issue them, give the server a key:</p>
            <ol className="mt-2 space-y-1 list-decimal pl-5">
              <li>
                Generate one with{' '}
                <code className="font-mono text-xs">pnpm --filter @eyo/api licence:new-key</code>,
                keeping the private half off every machine that does not need it.
              </li>
              <li>
                Set <code className="font-mono text-xs">VENDOR_SIGNING_KEY</code> to the PEM, or{' '}
                <code className="font-mono text-xs">VENDOR_SIGNING_KEY_PATH</code> to a file, and
                restart.
              </li>
              <li>
                Put the matching public half on each school&apos;s server as{' '}
                <code className="font-mono text-xs">LICENCE_PUBLIC_KEY</code>, or nothing it issues
                will verify there.
              </li>
            </ol>
          </div>
        )}
      </main>
    </>
  );
}
