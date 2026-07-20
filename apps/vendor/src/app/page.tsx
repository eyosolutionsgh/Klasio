import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { assessClient, type ClientHealth } from '@/lib/issue';
import { currentUser } from '@/lib/session-ui';
import { canIssue } from '@/lib/vendor-key';
import Header from './Header';
import NewClient from './NewClient';

export const dynamic = 'force-dynamic';

/**
 * Every school the vendor sells to, and how each is doing.
 *
 * Ordered by how much attention it needs rather than alphabetically. A list sorted by name is one
 * you have to read all of; this puts the handful worth ringing today at the top and lets the rest
 * be scenery.
 */
const HEALTH: Record<ClientHealth, { label: string; cls: string; rank: number }> = {
  ATTENTION: { label: 'Attention', cls: 'bg-danger/10 text-danger', rank: 0 },
  EXPIRED: { label: 'Expired', cls: 'bg-danger/10 text-danger', rank: 1 },
  SILENT: { label: 'Silent', cls: 'bg-clay/10 text-clay', rank: 2 },
  EXPIRING: { label: 'Expiring', cls: 'bg-clay/10 text-clay', rank: 3 },
  UNLICENSED: { label: 'Awaiting licence', cls: 'bg-hush text-slate', rank: 4 },
  OK: { label: 'Active', cls: 'bg-leaf/10 text-leaf', rank: 5 },
};

const when = (d: Date | null) =>
  d
    ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="card px-5 py-4">
      <p className="text-[11px] uppercase tracking-widest text-oat">{label}</p>
      <p className={`text-2xl font-semibold mt-1 tabular-nums ${tone ?? ''}`}>{value}</p>
    </div>
  );
}

export default async function Dashboard() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const clients = await db.client.findMany({
    include: {
      // The licence in force is the newest still standing — superseded ones are history, and a
      // withdrawn one was meant to count for nothing.
      licences: { where: { revokedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 },
      heartbeats: { orderBy: { receivedAt: 'desc' }, take: 1 },
    },
    orderBy: { name: 'asc' },
  });

  const rows = clients
    .map((c) => {
      const lic = c.licences[0] ?? null;
      const beat = c.heartbeats[0] ?? null;
      const { health, note, daysRemaining } = assessClient({
        licence: lic
          ? { tier: lic.tier, expiresAt: lic.expiresAt, studentCap: lic.studentCap }
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
      return { c, lic, beat, health, note, daysRemaining };
    })
    .sort(
      (a, b) => HEALTH[a.health].rank - HEALTH[b.health].rank || a.c.name.localeCompare(b.c.name),
    );

  const attention = rows.filter((r) => r.health === 'ATTENTION' || r.health === 'EXPIRED').length;
  const soon = rows.filter((r) => r.health === 'EXPIRING' || r.health === 'SILENT').length;

  // Reports from a slug no client owns — a deployment still to be recorded, or a slug that differs
  // from the one agreed. Either way it is the most interesting thing on the page.
  const orphans = await db.heartbeat.groupBy({
    by: ['schoolSlug'],
    where: { clientId: null },
    _count: { _all: true },
    _max: { receivedAt: true },
  });

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold">Client schools</h1>
            <p className="text-sm text-slate mt-0.5">
              Licences issued, and what each school&apos;s server reports back.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          <Stat label="Schools" value={clients.length} />
          <Stat label="Needs a call" value={attention} tone={attention ? 'text-danger' : ''} />
          <Stat label="Watch" value={soon} tone={soon ? 'text-clay' : ''} />
          <Stat
            label="Unrecorded"
            value={orphans.length}
            tone={orphans.length ? 'text-clay' : ''}
          />
        </div>

        {canIssue() ? null : (
          <p className="card mt-5 px-5 py-4 text-sm text-clay">
            Add a signing key to this server to issue licences from here. The CLI keeps working on
            any machine that holds the key.
          </p>
        )}

        {orphans.length > 0 && (
          <section className="card mt-5 px-5 py-4">
            <h2 className="text-sm font-semibold text-clay">Servers still to be recorded</h2>
            <p className="text-xs text-slate mt-1">
              These are reporting under a slug that belongs to no client here. Add them below using
              the same slug to claim their history.
            </p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {orphans.map((o) => (
                <li key={o.schoolSlug ?? 'unknown'} className="flex items-baseline gap-3">
                  <span className="font-mono text-[13px]">{o.schoolSlug ?? '—'}</span>
                  <span className="text-oat text-xs">
                    {o._count._all} report{o._count._all === 1 ? '' : 's'} · last{' '}
                    {when(o._max.receivedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="card mt-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-hush/60">
                <th className="px-5 py-3 font-medium">School</th>
                <th className="px-5 py-3 font-medium">Package</th>
                <th className="px-5 py-3 font-medium">Expires</th>
                <th className="px-5 py-3 font-medium text-right">Enrolled</th>
                <th className="px-5 py-3 font-medium">Last report</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, lic, beat, health, note, daysRemaining }) => (
                <tr key={c.id} className="border-b border-mist/70 last:border-0 hover:bg-hush/40">
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/clients/${c.id}`}
                      className="font-medium text-navy hover:underline"
                    >
                      {c.name}
                    </Link>
                    <p className="text-xs text-oat font-mono mt-0.5">{c.slug}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    {lic?.tier ?? '—'}
                    {/*
                      Shown only when the two disagree. A school running something other than what
                      it bought is the most useful cell on this page, and stating only what was
                      sold would hide it.
                    */}
                    {beat?.tierInForce && lic && beat.tierInForce !== lic.tier && (
                      <p className="text-xs text-danger mt-0.5">running {beat.tierInForce}</p>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    {when(lic?.expiresAt ?? null)}
                    {daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 30 && (
                      <p className="text-xs text-clay mt-0.5">{daysRemaining} days</p>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums">
                    {beat?.students ?? '—'}
                    {lic?.studentCap != null && (
                      <span className="text-oat"> / {lic.studentCap}</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">{when(beat?.receivedAt ?? null)}</td>
                  <td className="px-5 py-3.5">
                    <span className={`pill ${HEALTH[health].cls}`}>{HEALTH[health].label}</span>
                    {note && <p className="text-xs text-slate mt-1.5 max-w-[22rem]">{note}</p>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-slate">
                    Add the first school below to start issuing licences.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <NewClient />
      </main>
    </>
  );
}
