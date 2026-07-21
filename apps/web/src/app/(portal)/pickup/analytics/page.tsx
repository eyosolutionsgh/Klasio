import Link from 'next/link';
import { api, getMe } from '@/lib/api';

interface Analytics {
  windowDays: number;
  waits: {
    count: number;
    averageMinutes: number | null;
    medianMinutes: number | null;
    longestMinutes: number | null;
  };
  releases: { total: number; overrides: number };
  collectors: {
    key: string;
    name: string;
    kind: string;
    pickups: number;
    overrides: number;
    lastAt: string;
  }[];
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="rise rise-1">
        <Link href="/pickup" className="text-[13px] text-oat hover:text-brand transition">
          ← Back to dismissal
        </Link>
        <h1 className="font-display text-3xl mt-3">Dismissal analytics</h1>
      </div>
      <p className="card p-6 mt-6 text-sm text-oat rise rise-2">{children}</p>
    </div>
  );
}

export default async function DismissalAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const params = await searchParams;
  const me = await getMe();

  if (!me.entitlements.includes('safety.carline')) {
    return (
      <Notice>
        Dismissal analytics ride on the car line, which is part of a higher package. The gate, the
        release log and pickup security stay available — ask whoever manages your subscription about
        an upgrade to see wait times and collection history.
      </Notice>
    );
  }

  const days = Math.min(Math.max(parseInt(params.days ?? '30', 10) || 30, 1), 365);
  const data = await api<Analytics>(`/pickup/analytics?days=${days}`);

  const stat = (label: string, value: string) => (
    <div className="rounded-lg bg-parchment/60 py-4 px-3 text-center">
      <p className="font-display text-2xl tabular">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-oat mt-1">{label}</p>
    </div>
  );
  const min = (n: number | null) => (n === null ? '—' : `${n} min`);

  return (
    <div>
      <div className="rise rise-1 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/pickup" className="text-[13px] text-oat hover:text-brand transition">
            ← Back to dismissal
          </Link>
          <h1 className="font-display text-3xl mt-3">Dismissal analytics</h1>
          <p className="text-sm text-oat mt-1.5">
            How the gate has run over the last {data.windowDays} days.
          </p>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <Link
              key={d}
              href={`/pickup/analytics?days=${d}`}
              className={`min-h-9 inline-flex items-center rounded-full border px-3.5 text-[13px] transition ${
                days === d
                  ? 'border-brand bg-brand text-white'
                  : 'border-mist text-oat hover:border-brand'
              }`}
            >
              {d} days
            </Link>
          ))}
        </div>
      </div>

      <section className="card p-6 mt-6 rise rise-2">
        <h2 className="font-display text-xl">Car line waits</h2>
        <p className="text-sm text-oat mt-1">
          From &ldquo;I&apos;ve arrived&rdquo; to the handover being marked done.
        </p>
        {data.waits.count === 0 ? (
          <p className="text-sm text-oat mt-4">
            No finished car line pickups in this window yet — wait times fill in as the queue is
            used.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {stat('Pickups timed', String(data.waits.count))}
            {stat('Average wait', min(data.waits.averageMinutes))}
            {stat('Typical wait', min(data.waits.medianMinutes))}
            {stat('Longest wait', min(data.waits.longestMinutes))}
          </div>
        )}
      </section>

      <section className="card p-6 mt-6 rise rise-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-xl">Who collects</h2>
          <p className="text-[12px] text-oat tabular">
            {data.releases.total} release{data.releases.total === 1 ? '' : 's'}
            {data.releases.overrides > 0 && ` · ${data.releases.overrides} against advice`}
          </p>
        </div>
        <div className="overflow-x-auto mt-4 -mx-6 px-6">
          <table className="w-full text-sm table-stack">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-oat border-b border-mist">
                <th className="py-2 pr-4">Collector</th>
                <th className="py-2 pr-4">Pickups</th>
                <th className="py-2 pr-4">Against advice</th>
                <th className="py-2">Last collection</th>
              </tr>
            </thead>
            <tbody>
              {data.collectors.map((c) => (
                <tr key={c.key} className="border-b border-mist/50 last:border-0">
                  <td className="py-2.5 pr-4" data-label="Collector">
                    <span className="font-medium">{c.name}</span>
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-oat">
                      {c.kind.toLowerCase()}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 tabular" data-label="Pickups">
                    {c.pickups}
                  </td>
                  <td
                    className={`py-2.5 pr-4 tabular ${c.overrides > 0 ? 'text-clay font-medium' : ''}`}
                    data-label="Against advice"
                  >
                    {c.overrides}
                  </td>
                  <td className="py-2.5 tabular" data-label="Last collection">
                    {fmtDate(c.lastAt)}
                  </td>
                </tr>
              ))}
              {data.collectors.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-oat">
                    No releases in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
