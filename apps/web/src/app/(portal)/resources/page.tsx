import { api, getMe } from '@/lib/api';
import ResourceFilters from '@/components/ResourceFilters';
import UploadResource from '@/components/UploadResource';
import ResourceActions from '@/components/ResourceActions';
import Pagination from '@/components/Pagination';
import SortHeader from '@/components/SortHeader';
import { Button } from '@/components/Button';
import { SearchIcon } from '@/components/icons';
import { apiQuery, one, type ListSearchParams, type Page } from '@/lib/list';

interface Resource {
  id: string;
  title: string;
  description: string | null;
  filename: string;
  sizeBytes: number;
  published: boolean;
  downloads: number;
  createdAt: string;
  subjectName: string | null;
  levelName: string | null;
  className: string | null;
}
interface Structure {
  levels: { id: string; name: string }[];
  classes: { id: string; name: string; level: string }[];
  subjects: { id: string; name: string }[];
}

const STATES = [
  { key: 'true', label: 'Published' },
  { key: 'false', label: 'Drafts' },
];

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const q = one(params.q);
  // The page's own filters, plus the paging/sorting keys `apiQuery` always forwards.
  const qs = apiQuery(params, ['levelId', 'classId', 'subjectId', 'published', 'q']);

  const [resources, structure, me] = await Promise.all([
    api<Page<Resource>>(`/resources?${qs}`),
    api<Structure>('/school/structure'),
    getMe(),
  ]);

  const canManage = ['OWNER', 'HEAD', 'TEACHER'].includes(me.user.role);

  return (
    <div>
      <div className="rise rise-1 flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">Learning resources</h1>
          <p className="text-sm text-oat mt-1.5">
            Notes, homework and past questions. Nothing reaches a pupil or a guardian until it is
            published.
            {/* The total the filter matched, not the page size — the old list showed 200 and
                said nothing about the rest. */}
            {' · '}
            {resources.total} file{resources.total === 1 ? '' : 's'} matching
          </p>
        </div>
        <form
          className="flex gap-2 flex-1 min-w-[15rem] sm:flex-none"
          action="/resources"
          method="get"
        >
          {/*
            A GET form submits only its own fields, so every filter not represented here is
            dropped on search. Carrying them as hidden inputs is what keeps "search within JHS 2"
            from silently becoming "search the whole library". `page` is deliberately not carried
            — a new search starts at the beginning.
          */}
          {(
            [
              'levelId',
              'classId',
              'subjectId',
              'published',
              'sort',
              'order',
              'from',
              'to',
              'perPage',
            ] as const
          ).map((k) => {
            const v = one(params[k]);
            return v ? <input key={k} type="hidden" name={k} value={v} /> : null;
          })}
          {/* The magnifier rides the field, not the button — one per form is the affordance. */}
          <div className="relative flex-1 min-w-0 sm:w-64 sm:flex-none">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
              <SearchIcon />
            </span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search title or filename"
              className="w-full rounded-lg border border-mist bg-white pl-10 pr-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
      </div>

      <div className="mt-6 rise rise-2">
        <ResourceFilters
          levels={structure.levels}
          classes={structure.classes}
          subjects={structure.subjects}
          states={STATES}
          params={params}
        />
      </div>

      <div className="grid lg:grid-cols-[1fr_1.6fr] gap-6 mt-6">
        {canManage && (
          <UploadResource
            levels={structure.levels}
            classes={structure.classes}
            subjects={structure.subjects}
            allowMedia={me.entitlements.includes('resources.media')}
          />
        )}

        <div
          className={`card overflow-x-auto rise rise-3 table-stack-wrap ${
            canManage ? '' : 'lg:col-span-2'
          }`}
        >
          <table className="w-full text-sm table-stack">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
                <SortHeader column="title" base="/resources" params={params}>
                  Title
                </SortHeader>
                {/*
                  Not sortable. "For" collapses three independent tags — class, level and subject
                  — into one line, so ordering it would mean ordering by whichever of the three
                  the column happened to render first. The three are each sortable on the API's
                  allowlist; this cell is a summary, not a column.
                */}
                <th scope="col" className="px-5 py-3 font-medium">
                  For
                </th>
                <SortHeader
                  column="downloads"
                  base="/resources"
                  params={params}
                  defaultOrder="desc"
                >
                  Opens
                </SortHeader>
                <SortHeader column="published" base="/resources" params={params}>
                  Status
                </SortHeader>
                {canManage && <th className="px-5 py-3 font-medium sr-only">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {resources.rows.map((r) => (
                <tr key={r.id} className="border-b border-mist/60 last:border-0 align-top">
                  <td data-label="Title" className="px-5 py-3">
                    <a
                      href={`/api/proxy/resources/${r.id}/file`}
                      className="font-medium text-brand hover:underline underline-offset-2"
                    >
                      {r.title}
                    </a>
                    <span className="block text-[11px] text-oat">
                      {r.filename} · {kb(r.sizeBytes)}
                    </span>
                    {r.description && (
                      <span className="block text-[12px] text-ink/70 mt-1">{r.description}</span>
                    )}
                  </td>
                  <td data-label="For" className="px-5 py-3 text-oat">
                    {[r.className, r.levelName, r.subjectName].filter(Boolean).join(' · ') ||
                      'Whole school'}
                  </td>
                  <td data-label="Opens" className="px-5 py-3 tabular text-oat">
                    {r.downloads}
                  </td>
                  <td data-label="Status" className="px-5 py-3">
                    <span className={r.published ? 'text-brand' : 'text-clay'}>
                      {r.published ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-5 py-3">
                      <ResourceActions id={r.id} title={r.title} published={r.published} />
                    </td>
                  )}
                </tr>
              ))}
              {resources.rows.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 5 : 4} className="px-5 py-10 text-center text-oat">
                    Nothing matches. Try a different class, subject, status, date range or search
                    term — or upload a file to share it with a class.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Pagination page={resources} base="/resources" params={params} label="files" />
        </div>
      </div>
    </div>
  );
}
