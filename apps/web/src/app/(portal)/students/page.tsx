import Link from 'next/link';
import { api, getMe } from '@/lib/api';
import PromoteClass from '@/components/PromoteClass';
import DownloadButton from '@/components/DownloadButton';
import StudentFilters from '@/components/StudentFilters';
import AddStudent from '@/components/AddStudent';
import { Button } from '@/components/Button';
import { SearchIcon } from '@/components/icons';

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
  searchParams: Promise<{ classId?: string; q?: string; status?: string }>;
}) {
  const { classId, q, status = 'ACTIVE' } = await searchParams;
  const qs = new URLSearchParams();
  if (classId) qs.set('classId', classId);
  if (q) qs.set('q', q);
  qs.set('status', status);
  const [students, structure, me, enrolment] = await Promise.all([
    api<StudentRow[]>(`/students?${qs}`),
    api<Structure>('/school/structure'),
    getMe(),
    api<{ active: number; cap: number | null; headroom: number; atCap: boolean }>(
      '/students/enrolment',
    ),
  ]);

  const canPromote = ['OWNER', 'HEAD'].includes(me.user.role);
  const selectedClass = structure.classes.find((c) => c.id === classId);
  return (
    <div>
      <div className="rise rise-1 flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">Students</h1>
          <p className="text-sm text-oat mt-1.5">
            The register — {students.length} shown
            {enrolment.cap !== null && (
              <span className={enrolment.atCap ? 'text-clay font-medium' : ''}>
                {' · '}
                {enrolment.active} of {enrolment.cap} enrolled on {me.school.tier}
                {enrolment.atCap
                  ? ' — limit reached, upgrade to enrol more'
                  : ` (${enrolment.headroom} places left)`}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AddStudent classes={structure.classes} atCap={enrolment.atCap} />
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
            {classId && <input type="hidden" name="classId" value={classId} />}
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
        <StudentFilters
          status={status}
          classId={classId}
          q={q}
          statuses={STATUS_TABS}
          classes={structure.classes}
        />
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

      <div className="card mt-6 overflow-x-auto rise rise-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <th className="px-5 py-3 font-medium">Adm. No.</th>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Class</th>
              {/*
                One column, not two.
                A child can have several guardians, and two columns headed "Primary guardian" and
                "Phone" said otherwise — a single name with nothing beside it reads as the whole
                answer. The phone belongs under the name rather than beside it: it is a detail of
                that person, not a separate fact about the child.
              */}
              <th className="px-5 py-3 font-medium">Guardians</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr
                key={s.id}
                className="border-b border-mist/60 last:border-0 hover:bg-parchment/40 transition"
              >
                <td className="px-5 py-3 tabular text-oat">{s.admissionNo}</td>
                <td className="px-5 py-3">
                  <Link
                    href={`/students/${s.id}`}
                    className="font-medium text-brand hover:underline underline-offset-2"
                  >
                    {s.name}
                  </Link>
                </td>
                <td className="px-5 py-3">{s.className}</td>
                <td className="px-5 py-3">
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
            {students.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-oat">
                  No students match. Try a different class, status, or search term.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
