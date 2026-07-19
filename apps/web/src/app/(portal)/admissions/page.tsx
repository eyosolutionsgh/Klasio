import { api } from '@/lib/api';
import AdmissionsFilters from '@/components/AdmissionsFilters';
import ApplicantActions, { type ApplicantRow } from '@/components/ApplicantActions';
import Pagination from '@/components/Pagination';
import SortHeader from '@/components/SortHeader';
import { Button } from '@/components/Button';
import { SearchIcon } from '@/components/icons';
import { apiQuery, one, type ListSearchParams, type Page } from '@/lib/list';

type Applicant = ApplicantRow & {
  guardianName: string;
  guardianPhone: string;
  createdAt: string;
};

/**
 * The paged envelope plus the stage tallies, which the API counts across the whole school rather
 * than across the current page — a chip reading "3 applicants" has to mean the stage, not what
 * happens to be on screen.
 */
type Pipeline = Page<Applicant> & { counts: Record<string, number> };

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
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const q = one(params.q);
  // The page's own filters, plus the paging/sorting keys `apiQuery` always forwards.
  const qs = apiQuery(params, ['stage', 'q', 'levelId', 'gender']);

  const [pipeline, structure] = await Promise.all([
    api<Pipeline>(`/admissions?${qs}`),
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
            {/* The total the filter matched, not the page size — the old list showed 200 and
                said nothing about the rest. */}
            {' · '}
            {pipeline.total} matching
          </p>
        </div>
        <form
          className="flex gap-2 flex-1 min-w-[15rem] sm:flex-none"
          action="/admissions"
          method="get"
        >
          {/*
            A GET form submits only its own fields, so every filter not represented here is
            dropped on search. Carrying them as hidden inputs is what keeps "search within
            Offered" from silently becoming "search the whole pipeline". `page` is deliberately
            not carried — a new search starts at the beginning.
          */}
          {(['stage', 'levelId', 'gender', 'sort', 'order', 'from', 'to', 'perPage'] as const).map(
            (k) => {
              const v = one(params[k]);
              return v ? <input key={k} type="hidden" name={k} value={v} /> : null;
            },
          )}
          {/* The magnifier rides the field, not the button — one per form is the affordance. */}
          <div className="relative flex-1 min-w-0 sm:w-72 sm:flex-none">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
              <SearchIcon />
            </span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search name, reference or phone"
              className="w-full rounded-lg border border-mist bg-white pl-10 pr-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
      </div>

      <div className="mt-6 rise rise-2">
        <AdmissionsFilters
          stages={STAGES.map((s) => ({ ...s, count: pipeline.counts[s.key] ?? 0 }))}
          params={params}
        />
      </div>

      <div className="card mt-6 overflow-x-auto rise rise-3 table-stack-wrap">
        <table className="w-full text-sm table-stack">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <SortHeader column="reference" base="/admissions" params={params}>
                Reference
              </SortHeader>
              <SortHeader column="name" base="/admissions" params={params}>
                Child
              </SortHeader>
              <SortHeader column="guardianName" base="/admissions" params={params}>
                Guardian
              </SortHeader>
              {/* The filing date has its own column now rather than riding under the reference:
                  it is the thing an office sorts a backlog by, and a sort control needs a
                  heading of its own to hang on. */}
              <SortHeader column="createdAt" base="/admissions" params={params} defaultOrder="desc">
                Applied
              </SortHeader>
              <SortHeader column="stage" base="/admissions" params={params}>
                Stage
              </SortHeader>
              <th scope="col" className="px-5 py-3 font-medium text-right">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {pipeline.rows.map((a) => (
              <tr
                key={a.id}
                className="border-b border-mist/60 last:border-0 hover:bg-parchment/40 transition"
              >
                <td data-label="Reference" className="px-5 py-3 tabular text-oat whitespace-nowrap">
                  {a.reference}
                </td>
                <td data-label="Child" className="px-5 py-3">
                  <span className="font-medium">{a.name}</span>
                  <span className="block text-[12px] text-oat">
                    {a.levelName ?? 'No class yet'}
                  </span>
                </td>
                <td data-label="Guardian" className="px-5 py-3">
                  {a.guardianName}
                  <span className="block text-[12px] text-oat tabular">{a.guardianPhone}</span>
                </td>
                <td data-label="Applied" className="px-5 py-3 text-oat whitespace-nowrap">
                  {day(a.createdAt)}
                </td>
                <td data-label="Stage" className="px-5 py-3">
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
            {pipeline.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-oat">
                  No applications match. Try a different stage, date range or search term —
                  guardians applying through your public form land at Applied.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination page={pipeline} base="/admissions" params={params} label="applicants" />
      </div>
    </div>
  );
}
