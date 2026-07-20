import Link from 'next/link';
import { db } from '@/lib/db';
import { assessClient, type ClientHealth } from '@/lib/issue';
import { countByHealth, hasRange, HEALTH_ORDER, paginate, withinRange } from '@/lib/list';
import { requireUser } from '@/lib/session';
import { canIssue } from '@/lib/vendor-key';
import AddSchoolDialog from './AddSchoolDialog';
import DateFilters from './DateFilters';
import Header from './Header';
import Pagination from './Pagination';
import SearchBox from './SearchBox';
import StatusFilter, { HEALTH_LABEL } from './StatusFilter';

export const dynamic = 'force-dynamic';

/**
 * Every school the vendor sells to, and how each is doing.
 *
 * Ordered by how much attention it needs rather than alphabetically. A list sorted by name is one
 * you have to read all of; this puts the handful worth ringing today at the top and lets the rest
 * be scenery.
 *
 * Search, status and page all live in the URL, so a filtered view can be sent to a colleague and
 * the back button behaves — worth more here than it looks, because the way this page gets used is
 * "open the expiring ones, work through them, come back".
 */
const RANK = Object.fromEntries(HEALTH_ORDER.map((h, i) => [h, i])) as Record<ClientHealth, number>;

const when = (d: Date | null) =>
  d
    ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

/** How many unrecorded servers to name before summarising the rest. This panel grows too. */
const ORPHANS_SHOWN = 5;

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Redirects to the sign-in step they are actually at, rather than always to the start.
  await requireUser();

  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) || undefined;
  const q = one('q')?.trim();
  const statusParam = one('status');
  const status = HEALTH_ORDER.includes(statusParam as ClientHealth)
    ? (statusParam as ClientHealth)
    : undefined;
  /*
    Two ranges, because they answer different questions. Expiry is the renewals list — who needs
    ringing before the end of the month. Issue date is what was sold in a period, which is a
    reconciliation question someone asks at a quarter end.
  */
  const expiry = { from: one('expFrom'), to: one('expTo') };
  const issued = { from: one('issFrom'), to: one('issTo') };
  const params = {
    q,
    status,
    expFrom: expiry.from,
    expTo: expiry.to,
    issFrom: issued.from,
    issTo: issued.to,
  };

  const clients = await db.client.findMany({
    // The search runs in SQL, which is what keeps the set health is computed over small.
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q, mode: 'insensitive' } },
          ],
        }
      : undefined,
    include: {
      /*
        The licence in force is the one that is neither replaced nor withdrawn.

        Both conditions matter. Filtering on `revokedAt` alone means withdrawing the current
        licence promotes the one it replaced — so a school whose licence was just withdrawn reads
        as licensed again, on an older expiry. Withdrawing should leave no licence standing.
      */
      licences: {
        where: { revokedAt: null, supersededAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      heartbeats: { orderBy: { receivedAt: 'desc' }, take: 1 },
      // Counted rather than fetched: it only decides one sentence of wording.
      _count: { select: { licences: true } },
    },
    orderBy: { name: 'asc' },
  });

  const assessed = clients
    .map((c) => {
      const lic = c.licences[0] ?? null;
      const beat = c.heartbeats[0] ?? null;
      const { health, note, daysRemaining } = assessClient({
        everIssued: c._count.licences > 0,
        licence: lic ? { tier: lic.tier, expiresAt: lic.expiresAt } : null,
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
    .sort((a, b) => RANK[a.health] - RANK[b.health] || a.c.name.localeCompare(b.c.name));

  /*
    Dates narrow the set before the chips count it, unlike the status filter which the chips are.

    So "Expiring 4" beside an October range means four of October's expiries need a call — which is
    the question that pairs the two controls. A count that ignored the dates would describe a set
    the person is not looking at.

    Filtered in memory against the licence in force, the same one health is judged from. A SQL
    `some` over the client's licences would match any unrevoked one, including a superseded one
    with a different expiry — quietly answering a different question.
  */
  const dated = assessed.filter(
    (r) => withinRange(r.lic?.expiresAt, expiry) && withinRange(r.lic?.issuedAt, issued),
  );

  // Counted before the status filter, so a chip says how many schools are in that state rather
  // than how many the current view happens to show.
  const counts = countByHealth(dated);
  const matched = status ? dated.filter((r) => r.health === status) : dated;
  const page = paginate(matched, Number(one('page') ?? 1));

  // The whole estate, independent of any filter — a headline that moved when you searched would
  // be describing the search rather than the business.
  const totalClients = await db.client.count();

  // Reports from a slug no client owns — a deployment still to be recorded, or a slug that differs
  // from the one agreed. Either way it is the most interesting thing on the page.
  const orphans = await db.heartbeat.groupBy({
    by: ['schoolSlug'],
    where: { clientId: null },
    _count: { _all: true },
    _max: { receivedAt: true },
    orderBy: { _max: { receivedAt: 'desc' } },
  });

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold">Client schools</h1>
            <p className="text-sm text-slate mt-0.5">
              Licences issued, and what each school&apos;s server reports back.
            </p>
          </div>
          {/*
            The write stays at the top of the page, at a fixed spot, whatever the list is doing
            below it. As a panel under the table it drifted further away with every school sold.
          */}
          <AddSchoolDialog />
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
              These report under a slug that belongs to no client here. Add a school with the same
              slug to claim its history.
            </p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {orphans.slice(0, ORPHANS_SHOWN).map((o) => (
                <li key={o.schoolSlug ?? 'unknown'} className="flex items-baseline gap-3">
                  <span className="font-mono text-[13px]">{o.schoolSlug ?? '—'}</span>
                  <span className="text-oat text-xs">
                    {o._count._all} report{o._count._all === 1 ? '' : 's'} · last{' '}
                    {when(o._max.receivedAt)}
                  </span>
                </li>
              ))}
            </ul>
            {orphans.length > ORPHANS_SHOWN && (
              <p className="text-xs text-oat mt-2">
                and {orphans.length - ORPHANS_SHOWN} more, oldest reports first above.
              </p>
            )}
          </section>
        )}

        {/*
          Toolbar: find one school, or narrow to a state. Search and the chips compose — searching
          within "Expiring" is a real thing to want, so neither clears the other.
        */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <SearchBox initial={q ?? ''} />
          <DateFilters expiry={expiry} issued={issued} />
        </div>
        <div className="mt-3">
          <StatusFilter counts={counts} active={status} params={params} total={dated.length} />
        </div>

        <div className="card mt-4 overflow-hidden">
          <div className="overflow-x-auto">
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
                {page.rows.map(({ c, lic, beat, health, note, daysRemaining }) => (
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
                    <td className="px-5 py-3.5 text-right tabular-nums">{beat?.students ?? '—'}</td>
                    <td className="px-5 py-3.5">{when(beat?.receivedAt ?? null)}</td>
                    <td className="px-5 py-3.5">
                      <span className={`pill ${HEALTH_LABEL[health].cls} bg-hush`}>
                        {HEALTH_LABEL[health].label}
                      </span>
                      {note && <p className="text-xs text-slate mt-1.5 max-w-[22rem]">{note}</p>}
                    </td>
                  </tr>
                ))}
                {page.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-slate">
                      {/*
                        Three different empty tables, and they want three different sentences —
                        "nothing here" reads as a fault when the truth is "your filter is narrow".
                      */}
                      {totalClients === 0
                        ? 'Add the first school to start issuing licences.'
                        : q || status
                          ? hasRange(expiry) || hasRange(issued)
                            ? 'No school matches those dates. Widen the range, or clear it.'
                            : 'Widen the search or pick another status to see more schools.'
                          : 'Every school has been filtered out of this view.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {page.total > 0 && (
            <Pagination
              page={page.page}
              pageCount={page.pageCount}
              from={page.from}
              to={page.to}
              total={page.total}
              params={params}
            />
          )}
        </div>
      </main>
    </>
  );
}
