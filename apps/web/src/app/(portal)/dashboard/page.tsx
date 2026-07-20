import Link from 'next/link';
import { api, getMe, money } from '@/lib/api';

interface Stats {
  term: { id: string; name: string; year: string; nextTermBegins: string | null } | null;
  studentCount: number;
  staffCount: number;
  classCount: number;
  /**
   * Absent — not zeroed — for a role without `fees.view`. The dashboard is where every role
   * lands, so it cannot require a money permission, and the API drops the whole object rather
   * than sending a school's finances to the librarian, the nurse or the IT administrator.
   *
   * Optional in the type for that reason: read as required, `stats.fees.rate` throws on the
   * landing page for exactly those roles, which is a blank screen where their day starts.
   */
  fees?: { invoiced: number; collected: number; outstanding: number; rate: number };
  attendance: { date: string; present: number; total: number } | null;
  announcements: { id: string; title: string; body: string; publishedAt: string }[];
}

const HONORIFICS = new Set([
  'mr.',
  'mrs.',
  'ms.',
  'miss',
  'dr.',
  'rev.',
  'mr',
  'mrs',
  'ms',
  'dr',
  'rev',
]);

function firstName(full: string): string {
  const parts = full.trim().split(/\s+/);
  const first = parts.find((p) => !HONORIFICS.has(p.toLowerCase()));
  return first ?? parts[0] ?? '';
}

export default async function DashboardPage() {
  const [me, stats] = await Promise.all([getMe(), api<Stats>('/dashboard')]);
  const att = stats.attendance;
  const attPct = att && att.total > 0 ? Math.round((att.present / att.total) * 100) : null;
  const fees = stats.fees;
  const feePct = fees ? Math.round(fees.rate * 100) : null;

  return (
    <div>
      <div className="rise rise-1 flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-ink">
            Good day{me.user.name ? `, ${firstName(me.user.name)}` : ''}.
          </h1>
          <p className="text-sm text-oat mt-1.5">
            {stats.term ? `${stats.term.year} · ${stats.term.name}` : 'No term configured'}
            {stats.term?.nextTermBegins &&
              ` · Next term begins ${new Date(stats.term.nextTermBegins).toLocaleDateString('en-GH', { day: 'numeric', month: 'long', year: 'numeric' })}`}
          </p>
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
        {[
          {
            label: 'Students enrolled',
            value: stats.studentCount,
            tip: 'Active students on the register',
            cls: 'rise-1',
          },
          { label: 'Classes', value: stats.classCount, tip: 'From KG to JHS', cls: 'rise-2' },
          {
            label: 'Attendance',
            value: attPct != null ? `${attPct}%` : '—',
            sub: att
              ? `${att.present}/${att.total} on ${new Date(att.date).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })}`
              : 'Not marked yet',
            tip: 'Most recent marked school day',
            cls: 'rise-3',
          },
          // Spread rather than render-and-hide: a role without `fees.view` gets three tiles, not
          // four with one blanked out. An empty tile still says the school has a figure here.
          ...(fees
            ? [
                {
                  label: 'Fees collected',
                  value: `${feePct}%`,
                  sub: `${money(fees.collected)} of ${money(fees.invoiced)}`,
                  tip: 'Collected against billed this term',
                  cls: 'rise-4',
                },
              ]
            : []),
        ].map((s) => (
          <div key={s.label} data-tip={s.tip} className={`tip card card-accent p-5 rise ${s.cls}`}>
            <p className="text-[11px] uppercase tracking-widest text-oat">{s.label}</p>
            <p className="font-display text-3xl mt-2 tabular text-ink">{s.value}</p>
            {'sub' in s && s.sub && <p className="text-xs text-oat mt-1 tabular">{s.sub}</p>}
          </div>
        ))}
      </div>

      {/*
        Two columns only while there are two things to put in them. With the fees panel gone the
        announcements would otherwise sit in a 1fr column with dead space beside it.
      */}
      <div className={`grid gap-6 mt-8 ${fees ? 'lg:grid-cols-[1.4fr_1fr]' : ''}`}>
        {/* Fees position */}
        {fees && feePct != null && (
          <section className="card p-6 rise rise-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <h2 className="font-display text-xl">Fees position — {stats.term?.name}</h2>
              <Link
                href="/fees"
                className="text-[13px] text-brand font-medium hover:underline underline-offset-2"
              >
                Open fees →
              </Link>
            </div>
            <div
              className="mt-5 h-3 rounded-full bg-parchment overflow-hidden"
              role="img"
              aria-label={`${feePct}% collected`}
            >
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${Math.min(100, feePct)}%` }}
              />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-[11px] uppercase tracking-widest text-oat">Billed</p>
                <p className="tabular font-medium mt-1">{money(fees.invoiced)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-oat">Collected</p>
                <p className="tabular font-medium mt-1 text-leaf">{money(fees.collected)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-oat">Outstanding</p>
                <p className="tabular font-medium mt-1 text-clay">{money(fees.outstanding)}</p>
              </div>
            </div>
          </section>
        )}

        {/* Announcements */}
        <section className="card p-6 rise rise-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h2 className="font-display text-xl">Notice board</h2>
            <Link
              href="/announcements"
              className="text-[13px] text-brand font-medium hover:underline underline-offset-2"
            >
              All notices →
            </Link>
          </div>
          <ul className="mt-4 space-y-4">
            {stats.announcements.map((a) => (
              <li key={a.id} className="border-l-2 border-gold pl-3">
                <p className="text-sm font-medium leading-snug">{a.title}</p>
                <p className="text-xs text-oat mt-0.5 line-clamp-2">{a.body}</p>
              </li>
            ))}
            {stats.announcements.length === 0 && (
              <li className="text-sm text-oat">
                No notices yet. Post one from the Announcements page.
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
