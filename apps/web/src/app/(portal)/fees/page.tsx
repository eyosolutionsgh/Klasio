import { api, getMe, money as fmtMoney } from '@/lib/api';
import DefaultersTable, { type Defaulter } from '@/components/DefaultersTable';
import DepositQueue from '@/components/DepositQueue';
import FeeFilters from '@/components/FeeFilters';
import Pagination from '@/components/Pagination';
import SendReminders from '@/components/SendReminders';
import { Button } from '@/components/Button';
import { SearchIcon } from '@/components/icons';
import { apiQuery, one, type ListSearchParams, type Page } from '@/lib/list';

interface Overview {
  invoiced: number;
  collected: number;
  outstanding: number;
  byMethod: { method: string; amount: number }[];
  recentPayments: {
    id: string;
    student: string;
    className: string;
    amount: number;
    method: string;
    reference: string;
    receiptNumber: string | null;
    createdAt: string;
  }[];
  defaulterCount: number;
}
interface Structure {
  classes: { id: string; name: string; level: string; studentCount: number }[];
}

const METHOD_LABEL: Record<string, string> = {
  MOMO: 'Mobile Money',
  CASH: 'Cash',
  BANK: 'Bank',
  CARD: 'Card',
};

/**
 * Fees: what was billed, what came in, and who still owes.
 *
 * Server-rendered, like the rest of the portal's lists. It used to fetch everything in the browser
 * and render `defaulters.slice(0, 12)`, which meant the list on screen was a twelve-row sample of
 * an uncapped array sitting directly beneath an "Outstanding" tile counting every family. The
 * filters, the sort and the page are now the URL, and the tiles read figures the API computes over
 * the whole school — see the note on them below.
 */
export default async function FeesPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const me = await getMe();
  const termId = one(params.termId) ?? me.currentTerm?.id;
  const cur = me.school.currency;

  if (!termId) {
    return (
      <div>
        <div className="rise rise-1">
          <h1 className="font-display text-3xl">Fees</h1>
          <p className="text-sm text-oat mt-1.5">
            No term is marked current, so there is nothing to bill against yet. Set one in School
            Setup and this page will fill itself in.
          </p>
        </div>
      </div>
    );
  }

  const qs = apiQuery(params, ['classId', 'q'], { termId });
  const [ov, defaulters, structure] = await Promise.all([
    api<Overview>(`/fees/overview?termId=${termId}`),
    api<Page<Defaulter>>(`/fees/defaulters?${qs}`),
    api<Structure>('/school/structure'),
  ]);

  const collectedPct = ov.invoiced > 0 ? Math.round((ov.collected / ov.invoiced) * 100) : 0;
  const money = (n: number) => fmtMoney(n, cur);
  const filtered = !!(one(params.classId) || one(params.q));

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Fees</h1>
        <p className="text-sm text-oat mt-1.5">
          Billing, collections and the defaulter list for this term.
        </p>
      </div>

      {/*
        Every figure here comes from /fees/overview, which sums the whole school's ledger and the
        whole defaulter set. None of it is derived from the rows below — filtering the list to one
        class, or turning to page 2, must never move the school's outstanding total. That total is
        the number a head reads out at a board meeting.
      */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        {[
          {
            label: 'Billed',
            value: money(ov.invoiced),
            tip: 'Total billed this term',
            cls: 'rise-1',
          },
          {
            label: 'Collected',
            value: money(ov.collected),
            tip: `${collectedPct}% of billed`,
            cls: 'rise-2',
            tone: 'text-leaf',
          },
          {
            label: 'Outstanding',
            value: money(ov.outstanding),
            tip: 'Still to be collected, across every family',
            cls: 'rise-3',
            tone: 'text-clay',
          },
          {
            label: 'Defaulters',
            value: String(ov.defaulterCount),
            tip: 'Students with a balance owing',
            cls: 'rise-4',
          },
        ].map((s) => (
          <div key={s.label} data-tip={s.tip} className={`tip card card-accent p-5 rise ${s.cls}`}>
            <p className="text-[11px] uppercase tracking-widest text-oat">{s.label}</p>
            <p className={`font-display text-2xl mt-2 tabular ${s.tone ?? 'text-ink'}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <DepositQueue currency={cur} />

      <div className="grid lg:grid-cols-[1.3fr_1fr] gap-6 mt-8">
        {/* Defaulters */}
        <section className="card overflow-hidden rise rise-3">
          <div className="px-6 pt-5 pb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h2 className="font-display text-xl">Defaulters</h2>
            <span className="flex items-center gap-1 text-[12px]">
              <span className="text-oat">Export:</span>
              {(['csv', 'xlsx'] as const).map((f) => (
                <a
                  key={f}
                  href={`/api/proxy/fees/defaulters/export?termId=${termId}&format=${f}`}
                  className="rounded-md border border-mist px-2 py-0.5 text-brand hover:bg-brand-mist transition uppercase"
                >
                  {f}
                </a>
              ))}
            </span>
          </div>

          <div className="px-6 pb-1">
            {/*
              Reminders go to everyone who owes, not to the page on screen. The button says so, and
              the API's own reminder run works off the full defaulter set for the same reason the
              export does — a filtered view is a way of reading the list, not a way of choosing who
              gets texted.
            */}
            <SendReminders termId={termId} currency={cur} />
          </div>

          <div className="px-6 pb-4 pt-4 flex flex-wrap items-end gap-3">
            <FeeFilters classes={structure.classes} params={params} />
            <form className="flex gap-2 flex-1 min-w-[13rem]" action="/fees" method="get">
              {/*
                A GET form submits only its own fields, so every filter not represented here is
                dropped on search. Carrying them as hidden inputs keeps "search within this class"
                from silently becoming "search the whole school". `page` is deliberately not
                carried — a new search starts at the beginning.
              */}
              {(['classId', 'termId', 'sort', 'order', 'perPage'] as const).map((k) => {
                const v = one(params[k]);
                return v ? <input key={k} type="hidden" name={k} value={v} /> : null;
              })}
              <div className="relative flex-1 min-w-0">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                  <SearchIcon />
                </span>
                <input
                  type="search"
                  name="q"
                  defaultValue={one(params.q)}
                  placeholder="Search name or admission no."
                  className="w-full rounded-lg border border-mist bg-white pl-10 pr-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                />
              </div>
              <Button type="submit">Search</Button>
            </form>
          </div>

          {/*
            The count under a filter is the filtered count, and it is labelled as such. The
            unfiltered total is the "Defaulters" tile above, which never moves.
          */}
          {filtered && (
            <p className="px-6 pb-2 text-[12px] text-oat">
              <span className="tabular">{defaulters.total}</span> of{' '}
              <span className="tabular">{ov.defaulterCount}</span> defaulters match this filter
            </p>
          )}

          <DefaultersTable rows={defaulters.rows} currency={cur} params={params} />
          <Pagination page={defaulters} base="/fees" params={params} label="defaulters" />
        </section>

        {/* Recent payments + methods */}
        <div className="space-y-6">
          <section className="card p-6 rise rise-4">
            <h2 className="font-display text-xl">Collection by method</h2>
            <ul className="mt-4 space-y-3">
              {ov.byMethod.map((m) => {
                const pct = ov.collected > 0 ? Math.round((m.amount / ov.collected) * 100) : 0;
                return (
                  <li key={m.method ?? 'other'}>
                    <div className="flex justify-between text-sm">
                      <span>{METHOD_LABEL[m.method] ?? m.method}</span>
                      <span className="tabular font-medium">
                        {money(m.amount)} <span className="text-oat">({pct}%)</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-parchment mt-1.5 overflow-hidden">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
              {ov.byMethod.length === 0 && (
                <li className="text-sm text-oat">Nothing has been collected this term yet.</li>
              )}
            </ul>
          </section>

          <section className="card p-6 rise rise-4">
            {/*
              "Recent" is the whole claim this panel makes, so it is not paged. It is the last
              handful of payments, not a list of them — the full history lives on each student's
              record and in the export.
            */}
            <h2 className="font-display text-xl">Recent payments</h2>
            <ul className="mt-4 space-y-3">
              {ov.recentPayments.slice(0, 6).map((p) => (
                <li
                  key={p.id}
                  className="flex justify-between gap-3 text-sm border-b border-mist/50 last:border-0 pb-2.5 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{p.student}</p>
                    <p className="text-[11px] text-oat tabular">
                      {p.receiptNumber} · {METHOD_LABEL[p.method] ?? p.method}
                    </p>
                  </div>
                  <p className="tabular font-medium text-leaf shrink-0">{money(p.amount)}</p>
                </li>
              ))}
              {ov.recentPayments.length === 0 && (
                <li className="text-sm text-oat">No payment has been recorded yet.</li>
              )}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
