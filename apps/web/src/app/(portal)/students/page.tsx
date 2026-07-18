import Link from 'next/link';
import { api } from '@/lib/api';

interface StudentRow {
  id: string;
  admissionNo: string;
  name: string;
  gender: string;
  className: string;
  primaryGuardian: { name: string; phone: string } | null;
}
interface Structure {
  classes: { id: string; name: string; studentCount: number }[];
}

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ classId?: string; q?: string }>;
}) {
  const { classId, q } = await searchParams;
  const qs = new URLSearchParams();
  if (classId) qs.set('classId', classId);
  if (q) qs.set('q', q);
  const [students, structure] = await Promise.all([
    api<StudentRow[]>(`/students?${qs}`),
    api<Structure>('/school/structure'),
  ]);

  return (
    <div>
      <div className="rise rise-1 flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">Students</h1>
          <p className="text-sm text-oat mt-1.5">The register — {students.length} shown</p>
        </div>
        <form className="flex gap-2" action="/students" method="get">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search name or admission no."
            className="rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/15 w-64"
          />
          <button className="rounded-lg bg-forest text-paper text-sm font-medium px-4 hover:bg-forest-deep transition">
            Search
          </button>
        </form>
      </div>

      {/* class filter chips */}
      <div className="mt-6 flex flex-wrap gap-1.5 rise rise-2">
        <Link
          href="/students"
          className={`text-[12.5px] rounded-full px-3 py-1.5 border transition ${!classId ? 'bg-forest text-paper border-forest' : 'border-mist bg-white text-ink hover:border-forest'}`}
        >
          All classes
        </Link>
        {structure.classes
          .filter((c) => c.studentCount > 0)
          .map((c) => (
            <Link
              key={c.id}
              href={`/students?classId=${c.id}`}
              className={`text-[12.5px] rounded-full px-3 py-1.5 border transition tabular ${classId === c.id ? 'bg-forest text-paper border-forest' : 'border-mist bg-white text-ink hover:border-forest'}`}
            >
              {c.name} · {c.studentCount}
            </Link>
          ))}
      </div>

      <div className="card mt-6 overflow-hidden rise rise-3">
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
                  No students match. Try a different class or search term.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
