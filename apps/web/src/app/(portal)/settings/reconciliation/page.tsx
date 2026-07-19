import { api, getMe, money } from '@/lib/api';
import ImportSettlement from '@/components/ImportSettlement';
import Pagination from '@/components/Pagination';
import ReconciliationFilters from '@/components/ReconciliationFilters';
import ResolveException from '@/components/ResolveException';
import SortHeader from '@/components/SortHeader';
import { apiQuery, type ListSearchParams, type Page } from '@/lib/list';

interface Batch {
  id: string;
  provider: string;
  filename: string;
  grossTotal: number;
  netTotal: number;
  /** What the gateway kept across the whole file — the number a school rarely sees. */
  charges: number;
  rowCount: number;
  matchedCount: number;
  createdAt: string;
}
interface ExceptionRow {
  id: string;
  reference: string;
  gross: number;
  net: number;
  status: 'UNMATCHED' | 'MATCHED' | 'DISPUTED' | 'IGNORED';
  note: string | null;
  student: string | null;
  weCharged: number | null;
  createdAt: string;
}
/** The headline figures, counted over everything on file rather than over the page below them. */
interface Summary {
  unmatched: number;
  disputed: number;
  charges: number;
  batchCount: number;
}

const STATES = [
  { key: 'UNMATCHED', label: 'Not recognised' },
  { key: 'DISPUTED', label: 'Amount disagrees' },
  { key: 'MATCHED', label: 'Matched' },
  // A repeated reference in one file. The importer has always been able to record it, but with no
  // way to filter to it these rows could only be reached by scrolling the whole matched list.
  { key: 'DUPLICATE', label: 'Repeated in file' },
  { key: 'IGNORED', label: 'Set aside' },
];

/** Tone carries the same meaning as the words, so a queue can be triaged by colour. */
const TONE: Record<string, string> = {
  UNMATCHED: 'bg-danger/10 text-danger',
  DISPUTED: 'bg-clay/10 text-clay',
  MATCHED: 'bg-leaf/10 text-leaf',
  DUPLICATE: 'bg-clay/10 text-clay',
  IGNORED: 'bg-parchment text-oat',
};
const LABEL: Record<string, string> = Object.fromEntries(STATES.map((s) => [s.key, s.label]));

const day = (d: string) =>
  new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const qs = apiQuery(params, ['batchId', 'status']);

  const [batches, exceptions, summary, me] = await Promise.all([
    /**
     * Every import, not a page of them.
     *
     * The file filter is a picker: a bursar chasing a line from March needs March's file in the
     * list, and a picker that only offers the most recent page is a filter that cannot reach the
     * rows it is meant to narrow. The sidebar shows the newest few and says how many there are.
     */
    api<Page<Batch>>('/reconciliation/batches?perPage=all'),
    api<Page<ExceptionRow>>(`/reconciliation/exceptions?${qs}`),
    api<Summary>('/reconciliation/summary'),
    getMe(),
  ]);
  const cur = me.school.currency;
  const rows = exceptions.rows;

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Settlement reconciliation</h1>
        <p className="text-sm text-oat mt-1.5">
          Proving that every cedi the gateway remitted belongs to a payment you already hold.
          Importing a file changes no money — it only asserts what should match, and puts the rest
          in front of you.
        </p>
      </div>

      {/*
        Every tile reads from /reconciliation/summary, which counts and sums over the whole school.
        These used to be derived from the rows the page had fetched, so filtering the queue to one
        file — or, once it was paged, simply turning a page — moved the "not recognised" count and
        the gateway's total take. Those are statements about the school's money, and the table
        underneath them is not allowed to change them.
      */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        {[
          {
            label: 'Not recognised',
            value: String(summary.unmatched),
            tip: 'Money arrived under a reference we hold no payment for',
            cls: 'rise-1',
            tone: summary.unmatched ? 'text-danger' : undefined,
          },
          {
            label: 'Amount disagrees',
            value: String(summary.disputed),
            tip: 'We know the payment, but the gateway reports a different amount',
            cls: 'rise-2',
            tone: summary.disputed ? 'text-clay' : undefined,
          },
          {
            label: 'Gateway charges',
            value: money(summary.charges, cur),
            tip: 'Kept by the gateway across every file imported',
            cls: 'rise-3',
          },
          {
            label: 'Files imported',
            value: String(summary.batchCount),
            tip: 'Settlement files reconciled so far',
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

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-6 mt-8">
        {/* The exception queue is the screen. Everything else on it is background. */}
        <section className="card overflow-hidden rise rise-2">
          <div className="px-6 pt-5 pb-3">
            <h2 className="font-display text-xl">Exceptions</h2>
            <p className="text-xs text-oat mt-1">
              Every line here still needs a human. Closing one asks you why, and that reason is what
              anyone reading this back next term will actually have.
            </p>
          </div>

          <div className="px-6 pb-4">
            <ReconciliationFilters
              params={params}
              batches={batches.rows.map((b) => ({
                id: b.id,
                label: `${b.provider} · ${b.filename}`,
                hint: `${day(b.createdAt)} · ${b.rowCount} rows`,
              }))}
              states={STATES}
            />
          </div>

          <div className="overflow-x-auto table-stack-wrap">
            {/* `sm:` scoped: an unconditional floor survives the stacking media query and would
                hold the page at 640px on exactly the screens the stacking exists for. */}
            <table className="w-full text-sm sm:min-w-[640px] table-stack">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
                  <SortHeader
                    column="reference"
                    base="/settings/reconciliation"
                    params={params}
                    className="px-6 py-2.5"
                  >
                    Reference
                  </SortHeader>
                  {/*
                    "Against" is not sortable: the student and the amount we charged both come off
                    a PaymentIntent, and an unrecognised row — the whole reason this queue exists —
                    has no intent at all. Sorting by it would order the queue by a blank.
                  */}
                  <th className="px-3 py-2.5 font-medium">Against</th>
                  <SortHeader
                    column="gross"
                    base="/settings/reconciliation"
                    params={params}
                    align="right"
                    defaultOrder="desc"
                    className="px-3 py-2.5"
                  >
                    Gateway
                  </SortHeader>
                  <th className="px-3 py-2.5 font-medium text-right">We charged</th>
                  <SortHeader
                    column="status"
                    base="/settings/reconciliation"
                    params={params}
                    className="px-3 py-2.5"
                  >
                    State
                  </SortHeader>
                  <th className="px-6 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-mist/60 last:border-0 align-top">
                    <td data-label="Reference" className="px-6 py-3">
                      <p className="font-medium tabular">{r.reference}</p>
                      {r.note && <p className="text-[11.5px] text-oat mt-0.5">{r.note}</p>}
                    </td>
                    <td data-label="Against" className="px-3 py-3">
                      {r.student ? (
                        <span className="text-[12.5px]">{r.student}</span>
                      ) : (
                        <span className="text-[12.5px] text-danger">No payment on file</span>
                      )}
                      <span className="block text-[11px] text-oat">{day(r.createdAt)}</span>
                    </td>
                    <td
                      data-label="Gateway"
                      className="px-3 py-3 text-right tabular whitespace-nowrap"
                    >
                      {money(r.gross, cur)}
                      <span className="block text-[11px] text-oat">
                        {money(r.net, cur)} remitted
                      </span>
                    </td>
                    <td
                      data-label="We charged"
                      className="px-3 py-3 text-right tabular whitespace-nowrap"
                    >
                      {r.weCharged === null ? (
                        <span className="text-oat">—</span>
                      ) : (
                        <>
                          <span>{money(r.weCharged, cur)}</span>
                          {Math.abs(r.weCharged - r.gross) > 0.02 && (
                            <span className="block text-[11px] text-clay">
                              {r.gross > r.weCharged ? '+' : '−'}
                              {money(Math.abs(r.gross - r.weCharged), cur)}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td data-label="State" className="px-3 py-3">
                      <span
                        className={`inline-block text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 whitespace-nowrap ${TONE[r.status]}`}
                      >
                        {LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <ResolveException
                        id={r.id}
                        reference={r.reference}
                        student={r.student}
                        note={r.note}
                        currentStatus={r.status}
                      />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-oat">
                      {batches.total === 0 ? (
                        <>
                          Nothing to reconcile yet. Download a settlement file from Hubtel or
                          Paystack and import it on the right — every line that does not match a
                          payment you hold will appear here.
                        </>
                      ) : (
                        <>Nothing open. Every line in this view has been accounted for.</>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <Pagination
              page={exceptions}
              base="/settings/reconciliation"
              params={params}
              label="exceptions"
            />
          </div>
        </section>

        <div className="space-y-6">
          <ImportSettlement currency={cur} />

          <section className="card p-6 rise rise-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h2 className="font-display text-xl">Past imports</h2>
              {/* Say what is being shown of what, rather than letting eight look like all of them. */}
              {batches.total > 8 && (
                <p className="text-[12px] text-oat">
                  8 most recent of <span className="tabular">{batches.total}</span>
                </p>
              )}
            </div>
            <ul className="mt-4 space-y-3">
              {batches.rows.slice(0, 8).map((b) => (
                <li key={b.id} className="border-b border-mist/50 last:border-0 pb-3 last:pb-0">
                  <div className="flex justify-between gap-3">
                    <span className="text-sm font-medium truncate">{b.filename}</span>
                    <span className="text-[11px] text-oat shrink-0">{day(b.createdAt)}</span>
                  </div>
                  <p className="text-[12px] text-oat">
                    {b.provider} · {b.matchedCount} of {b.rowCount} matched
                  </p>
                  <p className="text-[12px] text-oat tabular mt-0.5">
                    {money(b.grossTotal, cur)} charged · {money(b.netTotal, cur)} remitted ·{' '}
                    <span className="text-clay">{money(b.charges, cur)} kept</span>
                  </p>
                </li>
              ))}
              {batches.total === 0 && (
                <li className="text-sm text-oat">No settlement file has been imported yet.</li>
              )}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
