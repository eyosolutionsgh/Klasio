import { api } from '@/lib/api';
import DownloadButton from '@/components/DownloadButton';
import ReturnsFilters from '@/components/ReturnsFilters';

interface Summary {
  school: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    region: string | null;
    country: string | null;
  };
  term: { id: string; name: string; year: string };
  enrolment: {
    byLevel: { level: string; category: string; boys: number; girls: number; total: number }[];
    boys: number;
    girls: number;
    total: number;
  };
  staffing: { byRole: { role: string; count: number }[]; total: number };
  attendance: { markedDays: number; presentRate: number | null };
  results: { reportsIssued: number; averageScore: number | null };
  generatedAt: string;
}
interface Structure {
  years: { id: string; name: string; terms: { id: string; name: string }[] }[];
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Proprietor',
  HEAD: 'Head teacher',
  BURSAR: 'Bursar',
  TEACHER: 'Teaching staff',
  FRONT_DESK: 'Administrative staff',
  GUARDIAN: 'Guardian accounts',
};

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ termId?: string }>;
}) {
  const { termId } = await searchParams;
  const [summary, structure] = await Promise.all([
    api<Summary>(`/returns${termId ? `?termId=${termId}` : ''}`),
    api<Structure>('/school/structure'),
  ]);

  // Newest year first is right for a picker of past terms — the one being filed is the recent one.
  const terms = structure.years.flatMap((y) =>
    y.terms.map((t) => ({ id: t.id, label: `${y.name} · ${t.name}` })),
  );
  const qs = `&termId=${summary.term.id}`;
  const e = summary.enrolment;

  return (
    <div>
      <div className="rise rise-1 flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">Termly returns</h1>
          <p className="text-sm text-oat mt-1.5">
            The counts GES and NaSIA ask for each term, assembled from the records you already keep.
            Nothing here is stored — the figures are the roll as it stands right now, so a return
            re-run later will not match one filed earlier.
          </p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <DownloadButton
            path={`/returns/export?format=xlsx${qs}`}
            filename={`returns-${summary.term.name.replace(/\s+/g, '')}.xlsx`}
            label="Download Excel"
            tip="One flat sheet, ready to re-key into the officer's template"
          />
          <DownloadButton
            path={`/returns/export?format=csv${qs}`}
            filename={`returns-${summary.term.name.replace(/\s+/g, '')}.csv`}
            label="CSV"
            variant="ghost"
          />
        </div>
      </div>

      <div className="mt-6 rise rise-2">
        <ReturnsFilters termId={summary.term.id} terms={terms} />
      </div>

      <div className="card p-6 mt-6 rise rise-2">
        <h2 className="font-display text-xl">{summary.school.name}</h2>
        <p className="text-sm text-oat mt-1">
          {[summary.school.address, summary.school.region, summary.school.country]
            .filter(Boolean)
            .join(' · ') || 'No address on file'}
        </p>
        <p className="text-sm text-oat mt-0.5">
          {[summary.school.phone, summary.school.email].filter(Boolean).join(' · ') || '—'}
        </p>
        <p className="text-[13px] mt-3 pt-3 border-t border-mist/60">
          {summary.term.year} · {summary.term.name} · prepared{' '}
          {new Date(summary.generatedAt).toLocaleString('en-GH', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6 rise rise-2">
        {[
          { label: 'On roll', value: String(e.total), hint: `${e.boys} boys · ${e.girls} girls` },
          {
            label: 'Staff',
            value: String(summary.staffing.total),
            hint: 'Active accounts',
          },
          {
            label: 'Attendance rate',
            value:
              summary.attendance.presentRate === null ? '—' : `${summary.attendance.presentRate}%`,
            hint: `${summary.attendance.markedDays} marked records`,
          },
          {
            label: 'Average score',
            value:
              summary.results.averageScore === null ? '—' : String(summary.results.averageScore),
            hint: `${summary.results.reportsIssued} reports issued`,
          },
        ].map((s) => (
          <div key={s.label} className="card px-5 py-4">
            <p className="text-[11px] uppercase tracking-widest text-oat">{s.label}</p>
            <p className="font-display text-2xl tabular mt-1">{s.value}</p>
            <p className="text-[11px] text-oat mt-1">{s.hint}</p>
          </div>
        ))}
      </div>

      {/* The table scrolls inside its own card on narrow screens rather than widening the page. */}
      <h2 className="font-display text-xl mt-8 rise rise-3">Enrolment by level and sex</h2>
      <div className="card mt-3 overflow-hidden rise rise-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
                <th className="px-5 py-3 font-medium">Level</th>
                <th className="px-5 py-3 font-medium">Category</th>
                <th className="px-5 py-3 font-medium text-right">Boys</th>
                <th className="px-5 py-3 font-medium text-right">Girls</th>
                <th className="px-5 py-3 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {e.byLevel.map((r) => (
                <tr key={r.level} className="border-b border-mist/60 last:border-0">
                  <td className="px-5 py-3 font-medium">{r.level}</td>
                  <td className="px-5 py-3 text-oat">{r.category}</td>
                  <td className="px-5 py-3 text-right tabular">{r.boys}</td>
                  <td className="px-5 py-3 text-right tabular">{r.girls}</td>
                  <td className="px-5 py-3 text-right tabular font-medium">{r.total}</td>
                </tr>
              ))}
              {e.byLevel.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-oat">
                    No levels set up yet — add them under School Setup.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-parchment/60">
                <td className="px-5 py-3 font-medium" colSpan={2}>
                  Total on roll
                </td>
                <td className="px-5 py-3 text-right tabular">{e.boys}</td>
                <td className="px-5 py-3 text-right tabular">{e.girls}</td>
                <td className="px-5 py-3 text-right tabular font-display text-base">{e.total}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      {/* A level total is not boys + girls: a child with no sex recorded still belongs on the
          roll, and dropping them would make this disagree with the register. */}
      {e.boys + e.girls !== e.total && (
        <p className="text-xs text-oat mt-2">
          {e.total - e.boys - e.girls} pupil{e.total - e.boys - e.girls === 1 ? '' : 's'} on the
          roll have no sex recorded, so the columns do not add to the total.
        </p>
      )}

      <div className="grid lg:grid-cols-2 gap-6 mt-8">
        <section className="card p-6 rise rise-3">
          <h2 className="font-display text-xl">Staffing</h2>
          <p className="text-xs text-oat mt-1">
            Active accounts by role. Someone without a login will not appear here.
          </p>
          <table className="w-full text-sm mt-4">
            <tbody>
              {summary.staffing.byRole.map((r) => (
                <tr key={r.role} className="border-b border-mist/50 last:border-0">
                  <td className="py-2.5">{ROLE_LABELS[r.role] ?? r.role}</td>
                  <td className="py-2.5 text-right tabular font-medium">{r.count}</td>
                </tr>
              ))}
              {summary.staffing.byRole.length === 0 && (
                <tr>
                  <td className="py-8 text-center text-oat">No staff accounts.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="card p-6 rise rise-3">
          <h2 className="font-display text-xl">Attendance and results</h2>
          <p className="text-xs text-oat mt-1">
            Taken from the register marked and the terminal reports computed for this term.
          </p>
          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex items-baseline justify-between gap-3 border-b border-mist/50 pb-2.5">
              <dt>Attendance rate</dt>
              <dd className="tabular font-medium">
                {summary.attendance.presentRate === null
                  ? 'Register not marked'
                  : `${summary.attendance.presentRate}%`}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-b border-mist/50 pb-2.5">
              <dt className="text-oat">Attendance records in the term</dt>
              <dd className="tabular text-oat">{summary.attendance.markedDays}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-b border-mist/50 pb-2.5">
              <dt>Average score</dt>
              <dd className="tabular font-medium">
                {summary.results.averageScore === null
                  ? 'No reports computed'
                  : summary.results.averageScore}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-oat">Reports issued</dt>
              <dd className="tabular text-oat">{summary.results.reportsIssued}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
