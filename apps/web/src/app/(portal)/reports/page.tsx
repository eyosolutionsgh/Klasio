import Link from 'next/link';
import { api, getMe } from '@/lib/api';
import Pagination from '@/components/Pagination';
import SortHeader from '@/components/SortHeader';
import ReportsFilters from '@/components/ReportsFilters';
import ReportActions from '@/components/ReportActions';
import { apiQuery, listHref, one, type ListSearchParams, type Page } from '@/lib/list';

interface ReportRow {
  studentId: string;
  name: string;
  admissionNo: string;
  overallTotal: number;
  classPosition: number | null;
  classSize: number | null;
  publishedAt: string | null;
}
interface Structure {
  classes: { id: string; name: string; level: string; studentCount: number }[];
}
interface Broadsheet {
  className: string;
  termName?: string;
  earlyYears: boolean;
  subjects: { id: string; name: string; code: string }[];
  rows: {
    admissionNo: string;
    name: string;
    cells: { total: number | null }[];
    overallTotal: number;
    position: number | null;
  }[];
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const [me, structure] = await Promise.all([getMe(), api<Structure>('/school/structure')]);

  // A class with nobody in it has no reports to compute, and offering it only produces an empty
  // table that reads as a failure to generate.
  const classes = structure.classes.filter((c) => c.studentCount > 0);
  const classId = one(params.classId) ?? classes[0]?.id;
  const termId = me.currentTerm?.id;
  const showBroadsheet = one(params.broadsheet) === '1';

  if (!classId || !termId) {
    return (
      <div>
        <div className="rise rise-1">
          <h1 className="font-display text-3xl">Terminal reports</h1>
        </div>
        <p className="card p-6 mt-6 text-sm text-oat rise rise-2">
          {termId
            ? 'No class has any students enrolled yet. Add students to a class, then come back to generate their reports.'
            : 'No term is running. Set the current term in School Setup before generating terminal reports.'}
        </p>
      </div>
    );
  }

  const qs = apiQuery(params, ['status'], { classId, termId });
  const [reports, unpublished, published, broadsheet] = await Promise.all([
    api<Page<ReportRow>>(`/assessment/reports?${qs}`),
    /**
     * How many reports in the whole class are still unreleased, not how many on this page.
     *
     * Publishing acts on the class and term, so the button has to be decided from the class and
     * term. `perPage=1` because only `total` is read — this asks a count, not a list.
     */
    api<Page<ReportRow>>(
      `/assessment/reports?classId=${classId}&termId=${termId}&status=UNPUBLISHED&perPage=1`,
    ),
    /**
     * And how many families have already read one. Asked of the class rather than subtracted from
     * `reports.total`, which is filtered by whatever the user has selected — deriving it would
     * make the regeneration warning disappear simply because someone filtered to "unpublished".
     */
    api<Page<ReportRow>>(
      `/assessment/reports?classId=${classId}&termId=${termId}&status=PUBLISHED&perPage=1`,
    ),
    showBroadsheet
      ? api<Broadsheet>(`/assessment/broadsheet?classId=${classId}&termId=${termId}`)
      : Promise.resolve(null),
  ]);

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Terminal reports</h1>
        <p className="text-sm text-oat mt-1.5">
          Computes SBA (30%) + exam (70%), GES grades, subject and class positions from saved
          scores.{' '}
          <Link href="/reports/outlook" className="text-brand underline underline-offset-2">
            BECE &amp; WASSCE outlook →
          </Link>
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3 rise rise-2">
        <ReportsFilters classes={classes} params={params} />
        <ReportActions
          classId={classId}
          termId={termId}
          total={reports.total}
          unpublishedCount={unpublished.total}
          publishedCount={published.total}
        />
        {/* A disclosure rather than an action, so it is a link and survives a refresh. */}
        <Link
          href={listHref('/reports', params, { broadsheet: showBroadsheet ? undefined : '1' })}
          className="rounded-lg border border-mist px-4 py-2 text-sm font-medium text-brand transition hover:bg-brand-mist"
        >
          {showBroadsheet ? 'Hide broadsheet' : 'View broadsheet'}
        </Link>
        <span className="flex items-center gap-1 text-[13px]">
          <span className="text-oat">Export:</span>
          {(['csv', 'xlsx', 'pdf'] as const).map((f) => (
            <a
              key={f}
              href={`/api/proxy/assessment/broadsheet/export?classId=${classId}&termId=${termId}&format=${f}`}
              className="rounded-md border border-mist px-2.5 py-1 text-brand hover:bg-brand-mist transition uppercase"
            >
              {f}
            </a>
          ))}
        </span>
      </div>

      {broadsheet && (
        /*
          Deliberately not `table-stack`: a broadsheet is one row per child against one column per
          subject, and stacking it would turn each pupil into a list of twelve subject names — the
          comparison down a column is the entire point of the document. It scrolls sideways on a
          phone instead, which is how the paper version is read too.
        */
        <div className="card mt-6 overflow-x-auto rise rise-2">
          <table className="w-full text-[13px] border-collapse">
            <caption className="sr-only">
              Broadsheet for {broadsheet.className}
              {broadsheet.termName ? `, ${broadsheet.termName}` : ''}
            </caption>
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider bg-parchment/60">
                <th className="border border-mist px-2 py-2 text-left font-medium">Adm.</th>
                <th className="border border-mist px-2 py-2 text-left font-medium">Name</th>
                {broadsheet.subjects.map((s) => (
                  <th
                    key={s.id}
                    className="border border-mist px-2 py-2 font-medium"
                    title={s.name}
                  >
                    {s.code}
                  </th>
                ))}
                {!broadsheet.earlyYears && (
                  <>
                    <th className="border border-mist px-2 py-2 font-medium">Total</th>
                    <th className="border border-mist px-2 py-2 font-medium">Pos.</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {broadsheet.rows.map((r) => (
                <tr key={r.admissionNo}>
                  <td className="border border-mist px-2 py-1.5 tabular text-oat">
                    {r.admissionNo}
                  </td>
                  <td className="border border-mist px-2 py-1.5 font-medium whitespace-nowrap">
                    {r.name}
                  </td>
                  {r.cells.map((c, i) => (
                    <td key={i} className="border border-mist px-2 py-1.5 text-center tabular">
                      {c.total == null
                        ? '—'
                        : broadsheet.earlyYears
                          ? Math.round(c.total)
                          : c.total.toFixed(0)}
                    </td>
                  ))}
                  {!broadsheet.earlyYears && (
                    <>
                      <td className="border border-mist px-2 py-1.5 text-center tabular font-medium">
                        {r.overallTotal.toFixed(0)}
                      </td>
                      <td className="border border-mist px-2 py-1.5 text-center tabular">
                        {r.position ?? '—'}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card mt-6 overflow-x-auto rise rise-3 table-stack-wrap">
        <table className="w-full text-sm table-stack">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <SortHeader column="classPosition" base="/reports" params={params}>
                Position
              </SortHeader>
              <SortHeader column="name" base="/reports" params={params}>
                Student
              </SortHeader>
              <SortHeader
                column="overallTotal"
                base="/reports"
                params={params}
                align="right"
                defaultOrder="desc"
              >
                Overall total
              </SortHeader>
              <SortHeader
                column="publishedAt"
                base="/reports"
                params={params}
                align="right"
                defaultOrder="desc"
              >
                Report
              </SortHeader>
            </tr>
          </thead>
          <tbody>
            {reports.rows.map((r) => (
              <tr
                key={r.studentId}
                className="border-b border-mist/60 last:border-0 hover:bg-parchment/40 transition"
              >
                <td data-label="Position" className="px-5 py-3">
                  <span
                    className={`font-display text-lg tabular ${r.classPosition === 1 ? 'text-gold' : 'text-ink'}`}
                  >
                    {r.classPosition ? ordinal(r.classPosition) : '—'}
                  </span>
                  <span className="text-oat text-xs"> / {r.classSize}</span>
                </td>
                <td data-label="Student" className="px-5 py-3">
                  <p className="font-medium">
                    {r.name}
                    {r.publishedAt && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider bg-brand-mist text-brand rounded-full px-2 py-0.5">
                        Published
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-oat tabular">{r.admissionNo}</p>
                </td>
                <td data-label="Overall total" className="px-5 py-3 text-right tabular font-medium">
                  {r.overallTotal.toFixed(1)}
                </td>
                {/* No data-label: this is the row's action, and "Report: View terminal report" on
                    a phone would label a link with its own words. */}
                <td className="px-5 py-3 text-right">
                  <Link
                    href={`/reports/${r.studentId}/${termId}`}
                    className="text-brand font-medium text-[13px] hover:underline underline-offset-2"
                  >
                    View terminal report →
                  </Link>
                </td>
              </tr>
            ))}
            {reports.rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-oat">
                  No reports match — enter scores, then press “Generate reports”. If you have
                  filtered by publication or a date range, try clearing that first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination page={reports} base="/reports" params={params} label="reports" />
      </div>
    </div>
  );
}
