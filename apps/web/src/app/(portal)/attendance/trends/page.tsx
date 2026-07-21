import Link from 'next/link';
import { AtRiskPanel } from '@/components/RiskPanels';
import { api, getMe } from '@/lib/api';
import Pagination from '@/components/Pagination';
import SortHeader from '@/components/SortHeader';
import TrendsFilters from '@/components/TrendsFilters';
import { apiQuery, type ListSearchParams, type Page } from '@/lib/list';

interface ChronicRow {
  studentId: string;
  name: string;
  admissionNo: string;
  className: string;
  absent: number;
  total: number;
  rate: number;
}
interface Trends {
  markedRecords: number;
  overallRate: number;
  threshold: { rate: number; minDays: number };
  classes: { classId: string; name: string; rate: number; marked: number }[];
  chronic: Page<ChronicRow>;
}
interface Structure {
  classes: { id: string; name: string; level: string; studentCount: number }[];
}

const bar = (rate: number) => (rate >= 90 ? 'bg-leaf' : rate >= 80 ? 'bg-gold' : 'bg-clay');

/**
 * A frame for the cases where there is nothing to compute — no current term, or a package that
 * does not include the dashboards. Both used to leave the page on "Loading…" forever: the client
 * version simply never set its state, so a school on Basic sat watching a spinner rather than
 * being told the feature is not theirs.
 */
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="rise rise-1">
        <Link href="/attendance" className="text-[13px] text-oat hover:text-brand transition">
          ← Back to the register
        </Link>
        <h1 className="font-display text-3xl mt-3">Attendance patterns</h1>
      </div>
      <p className="card p-6 mt-6 text-sm text-oat rise rise-2">{children}</p>
    </div>
  );
}

export default async function AttendanceTrendsPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const me = await getMe();

  // The entitlement code, never the tier name — a standalone install gets the same set from its
  // licence, and this page has no business knowing what the bundles are called.
  if (!me.entitlements.includes('attendance.dashboards')) {
    return (
      <Notice>
        Attendance patterns are part of a higher package. The daily register stays available on
        every package — ask whoever manages your subscription to upgrade to see term-wide trends.
      </Notice>
    );
  }
  if (!me.currentTerm) {
    return (
      <Notice>
        No term is running. Set the current term in School Setup, and this will fill in from the
        registers marked against it.
      </Notice>
    );
  }

  const term = me.currentTerm;
  const qs = apiQuery(params, ['classId'], { termId: term.id });
  const [data, structure] = await Promise.all([
    api<Trends>(`/attendance/trends?${qs}`),
    api<Structure>('/school/structure'),
  ]);

  return (
    <div>
      <div className="rise rise-1">
        <Link href="/attendance" className="text-[13px] text-oat hover:text-brand transition">
          ← Back to the register
        </Link>
        <h1 className="font-display text-3xl mt-3">Attendance patterns</h1>
        <p className="text-sm text-oat mt-1.5">
          {term.academicYear.name} · {term.name} · {data.markedRecords.toLocaleString()} marked
          records
        </p>
      </div>

      <div className="mt-6 rise rise-2">
        <TrendsFilters classes={structure.classes} params={params} />
      </div>

      <div className="card p-6 mt-6 rise rise-2">
        <p className="text-[11px] uppercase tracking-widest text-oat">Attendance this term</p>
        <p className="font-display text-4xl tabular mt-1">{data.overallRate}%</p>
        <p className="text-xs text-oat mt-1">Present or late, across every marked register.</p>
      </div>

      <section className="card p-6 mt-6 rise rise-3">
        <h2 className="font-display text-xl">By class</h2>
        <p className="text-sm text-oat mt-1.5">Lowest first — where to look.</p>
        <ul className="mt-4 space-y-3">
          {data.classes.map((c) => (
            <li key={c.classId}>
              <div className="flex flex-wrap justify-between gap-x-3 text-sm">
                <span>{c.name}</span>
                <span className="tabular text-oat">
                  {c.rate}% · {c.marked} marks
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-parchment overflow-hidden">
                <div className={`h-full ${bar(c.rate)}`} style={{ width: `${c.rate}%` }} />
              </div>
            </li>
          ))}
          {data.classes.length === 0 && (
            <li className="text-sm text-oat">No registers marked in this window yet.</li>
          )}
        </ul>
      </section>

      <section className="card mt-6 rise rise-4">
        <div className="p-6 pb-0">
          <h2 className="font-display text-xl">Chronic absence</h2>
          <p className="text-sm text-oat mt-1.5">
            Missing {data.threshold.rate}% or more of sessions, over at least{' '}
            {data.threshold.minDays} marked days. A child missing one day a week looks unremarkable
            every single morning — this is where it shows.
          </p>
        </div>
        <div className="mt-4 overflow-x-auto table-stack-wrap">
          <table className="w-full text-sm table-stack">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-y border-mist bg-parchment/50">
                <SortHeader column="name" base="/attendance/trends" params={params}>
                  Student
                </SortHeader>
                <SortHeader column="className" base="/attendance/trends" params={params}>
                  Class
                </SortHeader>
                <SortHeader
                  column="absent"
                  base="/attendance/trends"
                  params={params}
                  align="right"
                  defaultOrder="desc"
                >
                  Absences
                </SortHeader>
                <SortHeader
                  column="rate"
                  base="/attendance/trends"
                  params={params}
                  align="right"
                  defaultOrder="desc"
                >
                  Rate
                </SortHeader>
              </tr>
            </thead>
            <tbody>
              {data.chronic.rows.map((c) => (
                <tr key={c.studentId} className="border-b border-mist/50 last:border-0">
                  <td data-label="Student" className="px-5 py-2.5">
                    <Link
                      href={`/students/${c.studentId}`}
                      className="font-medium text-brand hover:underline underline-offset-2"
                    >
                      {c.name}
                    </Link>
                    <span className="block text-[11px] text-oat tabular">{c.admissionNo}</span>
                  </td>
                  <td data-label="Class" className="px-5 py-2.5">
                    {c.className}
                  </td>
                  <td data-label="Absences" className="px-5 py-2.5 text-right tabular">
                    {c.absent} of {c.total}
                  </td>
                  <td
                    data-label="Rate"
                    className="px-5 py-2.5 text-right tabular font-medium text-clay"
                  >
                    {c.rate}%
                  </td>
                </tr>
              ))}
              {data.chronic.rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-oat">
                    Nobody is at the chronic-absence threshold. Good.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={data.chronic}
          base="/attendance/trends"
          params={params}
          label="children"
        />
      </section>

      <div className="mt-6">
        <AtRiskPanel />
      </div>
    </div>
  );
}
