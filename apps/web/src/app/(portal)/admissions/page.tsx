import { api } from '@/lib/api';
import AdmissionsFilters from '@/components/AdmissionsFilters';
import ApplicantActions, { type ApplicantRow } from '@/components/ApplicantActions';

interface Pipeline {
  counts: Record<string, number>;
  applicants: (ApplicantRow & {
    guardianName: string;
    guardianPhone: string;
    createdAt: string;
  })[];
}
interface Structure {
  classes: { id: string; name: string; level: string; studentCount: number }[];
}

/** The pipeline in order, plus the verdict that sits outside it. */
const STAGES = [
  { key: 'ENQUIRY', label: 'Enquiry' },
  { key: 'APPLIED', label: 'Applied' },
  { key: 'ASSESSED', label: 'Assessed' },
  { key: 'OFFERED', label: 'Offered' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'ENROLLED', label: 'Enrolled' },
  { key: 'DECLINED', label: 'Declined' },
];

const TONE: Record<string, string> = {
  OFFERED: 'bg-brand-mist text-brand',
  ACCEPTED: 'bg-leaf/10 text-leaf',
  ENROLLED: 'bg-leaf/10 text-leaf',
  DECLINED: 'bg-danger/10 text-danger',
};

const day = (d: string) =>
  new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' });

export default async function AdmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; q?: string }>;
}) {
  const { stage = '', q } = await searchParams;
  const qs = new URLSearchParams();
  if (stage) qs.set('stage', stage);
  if (q) qs.set('q', q);
  const [pipeline, structure] = await Promise.all([
    api<Pipeline>(`/admissions${qs.toString() ? `?${qs}` : ''}`),
    api<Structure>('/school/structure'),
  ]);

  const open = STAGES.filter((s) => !['ENROLLED', 'DECLINED'].includes(s.key)).reduce(
    (n, s) => n + (pipeline.counts[s.key] ?? 0),
    0,
  );

  return (
    <div>
      <div className="rise rise-1 flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">Admissions</h1>
          <p className="text-sm text-oat mt-1.5">
            {open} application{open === 1 ? '' : 's'} still open · {pipeline.counts.ENROLLED ?? 0}{' '}
            enrolled this far
          </p>
        </div>
        <form
          className="flex gap-2 flex-1 min-w-[15rem] sm:flex-none"
          action="/admissions"
          method="get"
        >
          {stage && <input type="hidden" name="stage" value={stage} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search name, reference or phone"
            className="rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 flex-1 min-w-0 sm:w-72 sm:flex-none"
          />
          <button className="rounded-lg bg-brand text-paper text-sm font-medium px-4 hover:bg-brand-deep transition">
            Search
          </button>
        </form>
      </div>

      <div className="mt-6 rise rise-2">
        <AdmissionsFilters
          stage={stage}
          q={q}
          stages={STAGES.map((s) => ({ ...s, count: pipeline.counts[s.key] ?? 0 }))}
        />
      </div>

      <div className="card mt-6 overflow-x-auto rise rise-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <th className="px-5 py-3 font-medium">Reference</th>
              <th className="px-5 py-3 font-medium">Child</th>
              <th className="px-5 py-3 font-medium">Guardian</th>
              <th className="px-5 py-3 font-medium">Stage</th>
              <th className="px-5 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {pipeline.applicants.map((a) => (
              <tr
                key={a.id}
                className="border-b border-mist/60 last:border-0 hover:bg-parchment/40 transition"
              >
                <td className="px-5 py-3 tabular text-oat whitespace-nowrap">
                  {a.reference}
                  <span className="block text-[11px]">{day(a.createdAt)}</span>
                </td>
                <td className="px-5 py-3">
                  <span className="font-medium">{a.name}</span>
                  <span className="block text-[12px] text-oat">
                    {a.levelName ?? 'No class yet'}
                  </span>
                </td>
                <td className="px-5 py-3">
                  {a.guardianName}
                  <span className="block text-[12px] text-oat tabular">{a.guardianPhone}</span>
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-medium ${
                      TONE[a.stage] ?? 'bg-parchment text-oat'
                    }`}
                  >
                    {STAGES.find((s) => s.key === a.stage)?.label ?? a.stage}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <ApplicantActions applicant={a} classes={structure.classes} />
                </td>
              </tr>
            ))}
            {pipeline.applicants.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-oat">
                  No applications here yet. Parents applying through your public form land at
                  Applied.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
