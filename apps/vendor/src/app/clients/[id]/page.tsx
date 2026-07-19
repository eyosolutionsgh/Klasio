import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ENTITLEMENT_CATALOGUE } from '@eyo/shared';
import { db } from '@/lib/db';
import { assessClient } from '@/lib/issue';
import { currentUser } from '@/lib/session-ui';
import { canIssue } from '@/lib/vendor-key';
import Header from '../../Header';
import IssueForm from './IssueForm';
import LicenceText from './LicenceText';

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
  const user = await currentUser();
  if (!user) redirect('/login');
  const { id } = await params;

  const client = await db.client.findUnique({
    where: { id },
    include: {
      licences: { orderBy: { createdAt: 'desc' }, include: { issuedBy: true } },
      heartbeats: { orderBy: { receivedAt: 'desc' }, take: 20 },
    },
  });
  if (!client) notFound();

  const live = client.licences.find((l) => !l.revokedAt) ?? null;
  const beat = client.heartbeats[0] ?? null;
  const { health, note } = assessClient({
    licence: live
      ? { tier: live.tier, expiresAt: live.expiresAt, studentCap: live.studentCap }
      : null,
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
      <Header userName={user.name} />
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
                <dd className="mt-0.5 tabular-nums">
                  {beat.students ?? '—'}
                  {beat.studentCap != null && (
                    <span className="text-oat"> / {beat.studentCap}</span>
                  )}
                </dd>
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
                <li key={l.id} className="border border-mist rounded p-4">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <p className="font-mono text-sm">{l.licenceId}</p>
                    <p className="text-xs text-oat">
                      {l.revokedAt
                        ? 'withdrawn'
                        : l.supersededAt
                          ? `replaced ${day(l.supersededAt)}`
                          : 'current'}
                    </p>
                  </div>
                  <p className="text-sm mt-1">
                    {l.tier} · cap {l.studentCap ?? 'unlimited'} · {day(l.issuedAt)} –{' '}
                    {day(l.expiresAt)} · {l.graceDays}d grace
                  </p>
                  {/*
                  The features sold on top of the package. Shown as labels rather than codes: the
                  person reading this is checking an invoice, and "AI report remarks" answers that
                  where "ai.remarks" needs looking up.
                */}
                  {l.extraEntitlements.length > 0 && (
                    <p className="text-sm mt-1.5">
                      <span className="text-slate">Plus </span>
                      {l.extraEntitlements
                        .map((c) => ENTITLEMENT_CATALOGUE.find((e) => e.code === c)?.label ?? c)
                        .join(', ')}
                    </p>
                  )}
                  {l.issuedBy && (
                    <p className="text-xs text-oat mt-1">Issued by {l.issuedBy.name}</p>
                  )}
                  {/*
                  The signed text, on demand. Kept so it can be re-sent when a school loses the
                  email — it is not a secret, the school already has it, and anyone with the public
                  key can verify it.
                */}
                  <LicenceText signed={l.signed} licenceId={l.licenceId} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {canIssue() ? (
          <IssueForm clientId={client.id} currentTier={live?.tier ?? 'MEDIUM'} />
        ) : (
          <p className="card mt-5 px-5 py-4 text-sm text-clay">
            Add a signing key to this server to issue licences here. The CLI keeps working on any
            machine that holds the key:{' '}
            <code className="font-mono text-xs">pnpm --filter @eyo/api licence:mint</code>.
          </p>
        )}
      </main>
    </>
  );
}
