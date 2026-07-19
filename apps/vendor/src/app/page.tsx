import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { assessClient, type ClientHealth } from '@/lib/issue';
import { currentUser, signOutForm } from '@/lib/session-ui';
import { canIssue } from '@/lib/vendor-key';
import NewClient from './NewClient';

export const dynamic = 'force-dynamic';

/**
 * Everything the vendor sells to, and how each one is doing.
 *
 * Ordered by how much attention it needs rather than alphabetically. A list of clients sorted by
 * name is a list you have to read all of; this one puts the four you should ring today at the top
 * and lets the rest be scenery.
 */
const HEALTH: Record<ClientHealth, { label: string; cls: string; rank: number }> = {
  ATTENTION: { label: 'Attention', cls: 'bg-danger/10 text-danger', rank: 0 },
  EXPIRED: { label: 'Expired', cls: 'bg-danger/10 text-danger', rank: 1 },
  SILENT: { label: 'Silent', cls: 'bg-clay/10 text-clay', rank: 2 },
  EXPIRING: { label: 'Expiring', cls: 'bg-clay/10 text-clay', rank: 3 },
  UNLICENSED: { label: 'No licence', cls: 'bg-mist text-oat', rank: 4 },
  OK: { label: 'OK', cls: 'bg-leaf/10 text-leaf', rank: 5 },
};

const when = (d: Date | null) =>
  d
    ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

export default async function Dashboard() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const clients = await db.client.findMany({
    include: {
      // The licence in force is the newest that has not been withdrawn — a superseded one is
      // history, but a revoked one was never meant to count.
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

  const needing = rows.filter((r) => r.health !== 'OK').length;

  // Reports from a slug no client owns: a deployment nobody sold, or a slug that does not match
  // what was agreed. Either way it is the most interesting thing on the page.
  const orphans = await db.heartbeat.groupBy({
    by: ['schoolSlug'],
    where: { clientId: null },
    _count: { _all: true },
    _max: { receivedAt: true },
  });

  return (
    <main className="p-6 lg:p-10 max-w-6xl mx-auto">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-oat">Klasio</p>
          <h1 className="text-2xl font-semibold">Licensing</h1>
          <p className="text-sm text-oat mt-1">
            {clients.length} client{clients.length === 1 ? '' : 's'}
            {needing > 0 && ` · ${needing} needing attention`}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-oat">{user.name}</span>
          {signOutForm()}
        </div>
      </header>

      {!canIssue() && (
        <p className="card mt-6 p-4 text-sm text-clay">
          No signing key is configured on this server, so licences can be tracked here but not
          issued. Set VENDOR_SIGNING_KEY or VENDOR_SIGNING_KEY_PATH.
        </p>
      )}

      {orphans.length > 0 && (
        <section className="card mt-6 p-4">
          <h2 className="text-sm font-medium text-danger">Reports from unknown schools</h2>
          <p className="text-xs text-oat mt-1">
            A server is reporting under a slug no client here owns — either a deployment that was
            never sold, or a slug that does not match what was agreed.
          </p>
          <ul className="mt-3 text-sm space-y-1">
            {orphans.map((o) => (
              <li key={o.schoolSlug ?? 'unknown'} className="flex gap-3">
                <span className="font-mono">{o.schoolSlug ?? '(no slug)'}</span>
                <span className="text-oat">
                  {o._count._all} report{o._count._all === 1 ? '' : 's'} · last{' '}
                  {when(o._max.receivedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="card mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist">
              <th className="px-4 py-3 font-medium">School</th>
              <th className="px-4 py-3 font-medium">Package</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium">Enrolled</th>
              <th className="px-4 py-3 font-medium">Last report</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, lic, beat, health, note, daysRemaining }) => (
              <tr key={c.id} className="border-b border-mist/60 last:border-0 align-top">
                <td className="px-4 py-3">
                  <Link href={`/clients/${c.id}`} className="font-medium text-navy hover:underline">
                    {c.name}
                  </Link>
                  <p className="text-xs text-oat font-mono">{c.slug}</p>
                </td>
                <td className="px-4 py-3">
                  {lic?.tier ?? '—'}
                  {/*
                    Shown only when the two disagree. A school running something other than what it
                    bought is the single most useful cell on this page, and it would be invisible
                    if the column just said what was sold.
                  */}
                  {beat?.tierInForce && lic && beat.tierInForce !== lic.tier && (
                    <p className="text-xs text-danger">running {beat.tierInForce}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  {when(lic?.expiresAt ?? null)}
                  {daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 30 && (
                    <p className="text-xs text-clay">{daysRemaining} days</p>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {beat?.students ?? '—'}
                  {lic?.studentCap != null && <span className="text-oat"> / {lic.studentCap}</span>}
                </td>
                <td className="px-4 py-3">{when(beat?.receivedAt ?? null)}</td>
                <td className="px-4 py-3">
                  <span
                    className={`text-[11px] uppercase tracking-wider rounded-full px-2 py-0.5 ${HEALTH[health].cls}`}
                  >
                    {HEALTH[health].label}
                  </span>
                  {note && <p className="text-xs text-oat mt-1 max-w-xs">{note}</p>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-oat">
                  No clients yet. Add the first school below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <NewClient />
    </main>
  );
}
