import Link from 'next/link';
import { api, getMe } from '@/lib/api';
import PromoteClass from '@/components/PromoteClass';
import DownloadButton from '@/components/DownloadButton';
import StudentFilters from '@/components/StudentFilters';
import AddStudent from '@/components/AddStudent';
import Pagination from '@/components/Pagination';
import SortHeader from '@/components/SortHeader';
import { Button } from '@/components/Button';
import { SearchIcon } from '@/components/icons';
import { apiQuery, one, type ListSearchParams, type Page } from '@/lib/list';

interface StudentRow {
  id: string;
  admissionNo: string;
  name: string;
  gender: string;
  status: string;
  className: string;
  // phone is omitted unless the caller holds students.guardians — see students.module.ts
  guardians: {
    total: number;
    // phone is omitted unless the caller holds students.guardians — see students.module.ts
    lead: { name: string; relationship: string; isPrimary: boolean; phone?: string } | null;
  };
}
interface Structure {
  classes: { id: string; name: string; level: string; studentCount: number }[];
}

const STATUS_TABS = [
  { key: 'ACTIVE', label: 'Active' },
  { key: 'GRADUATED', label: 'Alumni' },
  { key: 'TRANSFERRED', label: 'Transferred' },
  { key: 'WITHDRAWN', label: 'Withdrawn' },
];

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const classId = one(params.classId);
  const q = one(params.q);
  const status = one(params.status) ?? 'ACTIVE';
  // The page's own filters, plus the paging/sorting keys `apiQuery` always forwards.
  const qs = apiQuery(params, ['classId', 'q', 'gender'], { status });

  const [students, structure, me] = await Promise.all([
    api<Page<StudentRow>>(`/students?${qs}`),
    api<Structure>('/school/structure'),
    getMe(),
  ]);

  const canPromote = ['OWNER', 'HEAD'].includes(me.user.role);
  const selectedClass = structure.classes.find((c) => c.id === classId);
  return (
    <div>
      <div className="rise rise-1 flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">Students</h1>
          <p className="text-sm text-oat mt-1.5">
            {/* The total, not the page size. "25 shown" on a roll of 900 was the old lie. */}
            The register — {students.total} matching
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AddStudent classes={structure.classes} />
          <Link
            href="/students/onboarding"
            className="tip rounded-lg border border-mist text-brand text-sm font-medium px-4 py-2 hover:bg-brand-mist transition"
            data-tip="Bulk-import students from an Excel template"
          >
            Import
          </Link>
          <DownloadButton
            path={`/students/export?format=xlsx${classId ? `&classId=${classId}` : ''}&status=${status}`}
            filename={`students-${status.toLowerCase()}.xlsx`}
            label="Export"
            variant="ghost"
            tip="Download this list as Excel"
          />
          <form className="flex gap-2 flex-1 min-w-[15rem]" action="/students" method="get">
            {/*
              A GET form submits only its own fields, so every filter not represented here is
              dropped on search. Carrying them as hidden inputs is what keeps "search within this
              class" from silently becoming "search the whole school". `page` is deliberately not
              carried — a new search starts at the beginning.
            */}
            {(['classId', 'gender', 'sort', 'order', 'from', 'to', 'perPage'] as const).map((k) => {
              const v = one(params[k]);
              return v ? <input key={k} type="hidden" name={k} value={v} /> : null;
            })}
            <input type="hidden" name="status" value={status} />
            {/* The magnifier rides the field, not the button — one per form is the affordance. */}
            <div className="relative flex-1 min-w-0 sm:w-64 sm:flex-none">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                <SearchIcon />
              </span>
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search name or admission no."
                className="w-full rounded-lg border border-mist bg-white pl-10 pr-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
            </div>
            <Button type="submit">Search</Button>
          </form>
        </div>
      </div>

      <div className="mt-6 rise rise-2">
        <StudentFilters statuses={STATUS_TABS} classes={structure.classes} params={params} />
      </div>

      {canPromote && selectedClass && status === 'ACTIVE' && (
        <div className="mt-4 rise rise-2">
          <PromoteClass
            fromClassId={selectedClass.id}
            fromClassName={selectedClass.name}
            studentCount={selectedClass.studentCount}
            classes={structure.classes.map((c) => ({ id: c.id, name: c.name }))}
          />
        </div>
      )}

      <div className="card mt-6 overflow-x-auto rise rise-3 table-stack-wrap">
        <table className="w-full text-sm table-stack">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <SortHeader column="admissionNo" base="/students" params={params}>
                Adm. No.
              </SortHeader>
              <SortHeader column="name" base="/students" params={params}>
                Name
              </SortHeader>
              <SortHeader column="className" base="/students" params={params}>
                Class
              </SortHeader>
              {/*
                One column, not two.
                A child can have several guardians, and two columns headed "Primary guardian" and
                "Phone" said otherwise — a single name with nothing beside it reads as the whole
                answer. The phone belongs under the name rather than beside it: it is a detail of
                that person, not a separate fact about the child.

                Not sortable, for the same reason: ordering a list of children by a collection
                would mean ordering by whichever guardian the database happened to return first.
              */}
              <th scope="col" className="px-5 py-3 font-medium">
                Guardians
              </th>
            </tr>
          </thead>
          <tbody>
            {students.rows.map((s) => (
              <tr
                key={s.id}
                className="border-b border-mist/60 last:border-0 hover:bg-parchment/40 transition"
              >
                <td data-label="Adm. No." className="px-5 py-3 tabular text-oat">
                  {s.admissionNo}
                </td>
                <td data-label="Name" className="px-5 py-3">
                  <Link
                    href={`/students/${s.id}`}
                    className="font-medium text-brand hover:underline underline-offset-2"
                  >
                    {s.name}
                  </Link>
                </td>
                <td data-label="Class" className="px-5 py-3">
                  {s.className}
                </td>
                <td data-label="Guardians" className="px-5 py-3">
                  {s.guardians.lead ? (
                    <>
                      <p className="flex flex-wrap items-baseline gap-x-1.5">
                        <span>{s.guardians.lead.name}</span>
                        <span className="text-[12px] text-oat">
                          {s.guardians.lead.relationship}
                          {/* Say so when nobody is flagged primary, rather than implying one is. */}
                          {!s.guardians.lead.isPrimary && ' · no primary set'}
                        </span>
                      </p>
                      <p className="text-[12px] text-oat">
                        {s.guardians.lead.phone && (
                          <span className="tabular">{s.guardians.lead.phone}</span>
                        )}
                        {s.guardians.total > 1 && (
                          <>
                            {/*
                              Not "+2 more": Ghanaian numbers render as +233…, so a leading plus
                              immediately after one reads as a continuation of the number.
                            */}
                            {s.guardians.lead.phone && <span className="mx-1.5">·</span>}
                            <span>
                              {s.guardians.total - 1} other
                              {s.guardians.total - 1 === 1 ? '' : 's'}
                            </span>
                          </>
                        )}
                      </p>
                    </>
                  ) : (
                    <span className="text-oat">No guardian recorded</span>
                  )}
                </td>
              </tr>
            ))}
            {students.rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-oat">
                  No students match. Try a different class, status, gender, date range or search
                  term.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination page={students} base="/students" params={params} label="students" />
      </div>
    </div>
  );
}
