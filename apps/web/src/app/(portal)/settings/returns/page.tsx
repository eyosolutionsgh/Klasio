import Link from 'next/link';
import { api, apiOrNull } from '@/lib/api';
import DownloadButton from '@/components/DownloadButton';
import ReturnsFilters from '@/components/ReturnsFilters';
import { ROLE_LABELS } from '@/lib/roles';

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
    byLevel: { level: string; category: string; male: number; female: number; total: number }[];
    male: number;
    female: number;
    total: number;
  };
  staffing: { byRole: { role: string; count: number }[]; total: number };
  attendance: { markedDays: number; presentRate: number | null };
  results: { reportsIssued: number; averageScore: number | null };
  generatedAt: string;
}
interface Structure {
  years: { id: string; name: string; terms: { id: string; name: string }[] }[];
  classes: { id: string; name: string; category: string }[];
}

/** PRE_SCHOOL → Pre school. The enum is an implementation detail, not something to file. */
const humanise = (s: string) =>
  s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ termId?: string }>;
}) {
  const { termId } = await searchParams;
  /**
   * The summary may legitimately not exist: a return is a snapshot of one term's roll, so a school
   * that has not set a current term has nothing to snapshot and the API says so with a 404. That
   * used to reach the error boundary as "This page couldn't load. A server error occurred", which
   * told a head teacher the software was broken when the answer was "set your term".
   *
   * The structure is fetched either way, because it is what lets them choose a term and carry on.
   */
  const [summary, structure] = await Promise.all([
    apiOrNull<Summary>(`/returns${termId ? `?termId=${termId}` : ''}`),
    api<Structure>('/school/structure'),
  ]);

  // Newest year first is right for a picker of past terms — the one being filed is the recent one.
  const terms = structure.years.flatMap((y) =>
    y.terms.map((t) => ({ id: t.id, label: `${y.name} · ${t.name}` })),
  );

  if (!summary) return <NoTerm terms={terms} />;
  const qs = `&termId=${summary.term.id}`;
  /*
    WAEC and CSSPS concern leaving classes only. Filtered on the level category rather than the
    class name, since a school may call JHS 3 anything it likes.
  */
  const jhsClasses = (structure.classes ?? []).filter(
    (c) => c.category === 'JHS' || c.category === 'SHS',
  );
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

      {/*
        The other bodies a school answers to. These are exports rather than integrations: none of
        them publishes an API, and their templates are reissued most years — so the sheet carries
        every field the body is known to want and somebody pastes it into this year's form.
      */}
      <section className="card p-6 mt-6 rise rise-2">
        <h2 className="font-display text-xl">WAEC, CSSPS and the annual census</h2>
        <p className="text-sm text-oat mt-1 max-w-prose">
          Sheets built from your own records, for the returns that are not termly. Check the names
          against birth certificates before submitting anything to WAEC — the candidate sheet marks
          the ones nobody has checked.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <DownloadButton
            path="/compliance/admission-register?format=xlsx"
            filename="admission-register.xlsx"
            label="Admission register"
            variant="ghost"
            tip="Every child ever admitted, in admission-number order — the register an inspection asks for"
          />
          <DownloadButton
            path={`/compliance/emis/census?format=xlsx`}
            filename="emis-census.xlsx"
            label="EMIS census"
            variant="ghost"
            tip="Enrolment by class, sex and age, plus the staff list with NTC numbers and qualifications"
          />
        </div>

        {jhsClasses.length > 0 && (
          <div className="mt-5 border-t border-mist/60 pt-4">
            <p className="text-xs uppercase tracking-widest text-oat">Per candidate class</p>
            <ul className="mt-2 space-y-2">
              {jhsClasses.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-28 font-medium">{c.name}</span>
                  <DownloadButton
                    path={`/compliance/waec/candidates?classId=${c.id}&format=xlsx`}
                    filename={`waec-candidates-${c.name.replace(/\s+/g, '-')}.xlsx`}
                    label="WAEC candidates"
                    variant="ghost"
                  />
                  <DownloadButton
                    path={`/compliance/waec/sba?classId=${c.id}&termId=${summary.term.id}&format=xlsx`}
                    filename={`waec-sba-${c.name.replace(/\s+/g, '-')}.xlsx`}
                    label="SBA marks"
                    variant="ghost"
                  />
                  <DownloadButton
                    path={`/compliance/cssps/export/${c.id}?format=xlsx`}
                    filename={`cssps-choices-${c.name.replace(/\s+/g, '-')}.xlsx`}
                    label="CSSPS choices"
                    variant="ghost"
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

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
          { label: 'On roll', value: String(e.total), hint: `${e.male} male · ${e.female} female` },
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
        {/* `sm:`-scoped floor: an unconditional min-width survives the stacking media query and
            would hold this 480px wide on exactly the handsets the stacking is for. */}
        <div className="overflow-x-auto table-stack-wrap">
          <table className="w-full text-sm sm:min-w-[480px] table-stack">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
                <th className="px-5 py-3 font-medium">Level</th>
                <th className="px-5 py-3 font-medium">Category</th>
                <th className="px-5 py-3 font-medium text-right">Male</th>
                <th className="px-5 py-3 font-medium text-right">Female</th>
                <th className="px-5 py-3 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {e.byLevel.map((r) => (
                <tr key={r.level} className="border-b border-mist/60 last:border-0">
                  <td data-label="Level" className="px-5 py-3 font-medium">
                    {r.level}
                  </td>
                  <td data-label="Category" className="px-5 py-3 text-oat">
                    {humanise(r.category)}
                  </td>
                  <td data-label="Male" className="px-5 py-3 text-right tabular">
                    {r.male}
                  </td>
                  <td data-label="Female" className="px-5 py-3 text-right tabular">
                    {r.female}
                  </td>
                  <td data-label="Total" className="px-5 py-3 text-right tabular font-medium">
                    {r.total}
                  </td>
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
                <td data-label="Male" className="px-5 py-3 text-right tabular">
                  {e.male}
                </td>
                <td data-label="Female" className="px-5 py-3 text-right tabular">
                  {e.female}
                </td>
                <td
                  data-label="Total"
                  className="px-5 py-3 text-right tabular font-display text-base"
                >
                  {e.total}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      {/* A level total is not male + female: a child with no sex recorded still belongs on the
          roll, and dropping them would make this disagree with the register. */}
      {e.male + e.female !== e.total && (
        <p className="text-xs text-oat mt-2">
          {e.total - e.male - e.female} pupil{e.total - e.male - e.female === 1 ? '' : 's'} on the
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

/**
 * What the page says before there is a term to report on.
 *
 * Two different situations, and they need different answers. A school that has set up its calendar
 * but marked no term current can simply pick one and file it — a return for a past term is a
 * normal thing to want, and the picker already supports it. A school with no calendar at all has
 * nothing to pick, so it is sent to where terms are created rather than shown an empty control.
 */
function NoTerm({ terms }: { terms: { id: string; label: string }[] }) {
  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Termly returns</h1>
        <p className="text-sm text-oat mt-1.5 max-w-2xl">
          The counts GES and NaSIA ask for each term, assembled from the records you already keep.
        </p>
      </div>

      <div className="card p-6 mt-6 max-w-2xl rise rise-2">
        <h2 className="font-display text-xl">
          {terms.length > 0 ? 'Choose a term to report on' : 'No terms set up yet'}
        </h2>
        <p className="text-sm text-oat mt-2 leading-relaxed">
          {terms.length > 0
            ? 'A return is the roll as it stood in one particular term, and none is currently marked as running. Pick the term you are filing for.'
            : 'A return counts one term’s enrolment, staffing, attendance and results — so there is nothing to assemble until your academic year and its terms exist.'}
        </p>
        {terms.length > 0 ? (
          <div className="mt-4">
            <ReturnsFilters termId="" terms={terms} />
          </div>
        ) : (
          <Link
            href="/settings/school"
            className="inline-block mt-4 text-[13px] text-brand hover:underline underline-offset-2"
          >
            Set up the academic year
          </Link>
        )}
      </div>
    </div>
  );
}
