import Link from 'next/link';
import { api, getMe } from '@/lib/api';
import PromoteClass from '@/components/PromoteClass';
import DownloadButton from '@/components/DownloadButton';

interface StudentRow {
  id: string;
  admissionNo: string;
  name: string;
  gender: string;
  status: string;
  className: string;
  primaryGuardian: { name: string; phone: string } | null;
}
interface Structure {
  classes: { id: string; name: string; studentCount: number }[];
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
  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (classId) p.set('classId', classId);
    if (q) p.set('q', q);
    p.set('status', status);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/students?${p}`;
  };

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
          <Link
            href="/students/onboarding"
            className="tip rounded-lg border border-mist text-forest text-sm font-medium px-4 py-2 hover:bg-forest-mist transition"
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
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search name or admission no."
              className="rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/15 flex-1 min-w-0 sm:w-64 sm:flex-none"
            />
            <button className="rounded-lg bg-forest text-paper text-sm font-medium px-4 hover:bg-forest-deep transition">
              Search
            </button>
          </form>
        </div>
      </div>

      {/* status tabs */}
      <div className="mt-6 flex flex-wrap gap-1.5 rise rise-2">
        {STATUS_TABS.map((t) => (
          <Link
            key={t.key}
            href={keep({ status: t.key })}
            className={`text-[12.5px] rounded-full px-3 py-1.5 border transition ${status === t.key ? 'bg-forest text-paper border-forest' : 'border-mist bg-white text-ink hover:border-forest'}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* class filter chips */}
      <div className="mt-3 flex flex-wrap gap-1.5 rise rise-2">
        <Link
          href={`/students?status=${status}`}
          className={`text-[12.5px] rounded-full px-3 py-1.5 border transition ${!classId ? 'bg-forest text-paper border-forest' : 'border-mist bg-white text-ink hover:border-forest'}`}
        >
          All classes
        </Link>
        {structure.classes
          .filter((c) => c.studentCount > 0)
          .map((c) => (
            <Link
              key={c.id}
              href={`/students?classId=${c.id}&status=${status}`}
              className={`text-[12.5px] rounded-full px-3 py-1.5 border transition tabular ${classId === c.id ? 'bg-forest text-paper border-forest' : 'border-mist bg-white text-ink hover:border-forest'}`}
            >
              {c.name} · {c.studentCount}
            </Link>
          ))}
      </div>

      {canPromote && selectedClass && status === 'ACTIVE' && (
        <div className="mt-4 rise rise-2">
          <PromoteClass
            fromClassId={selectedClass.id}
            fromClassName={selectedClass.name}
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
              <th className="px-5 py-3 font-medium">Primary guardian</th>
              <th className="px-5 py-3 font-medium">Phone</th>
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
                    className="font-medium text-forest hover:underline underline-offset-2"
                  >
                    {s.name}
                  </Link>
                </td>
                <td className="px-5 py-3">{s.className}</td>
                <td className="px-5 py-3">{s.primaryGuardian?.name ?? '—'}</td>
                <td className="px-5 py-3 tabular text-oat">{s.primaryGuardian?.phone ?? '—'}</td>
              </tr>
            ))}
            {students.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-oat">
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
