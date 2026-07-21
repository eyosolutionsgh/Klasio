import Link from 'next/link';
import { api, getMe } from '@/lib/api';
import { one, type ListSearchParams } from '@/lib/list';

interface JhsStudent {
  id: string;
  name: string;
  admissionNo: string;
  aggregate: number | null;
  gap: string | null;
  subjects: { subject: string; isCore: boolean; total: number; grade: number }[];
}
interface ShsStudent {
  id: string;
  name: string;
  admissionNo: string;
  aggregate: number | null;
  credits: number;
  englishCredit: boolean;
  mathsCredit: boolean;
  ready: boolean;
}
interface Outlook {
  kind: 'JHS' | 'SHS';
  className: string;
  termName?: string;
  students: (JhsStudent | ShsStudent)[];
}
interface Structure {
  classes: { id: string; name: string; category: string; studentCount: number }[];
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="rise rise-1">
        <Link href="/reports" className="text-[13px] text-oat hover:text-brand transition">
          ← Back to reports
        </Link>
        <h1 className="font-display text-3xl mt-3">Examinations outlook</h1>
      </div>
      <p className="card p-6 mt-6 text-sm text-oat rise rise-2">{children}</p>
    </div>
  );
}

export default async function OutlookPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const [me, structure] = await Promise.all([getMe(), api<Structure>('/school/structure')]);

  if (!me.entitlements.includes('exams.analytics')) {
    return (
      <Notice>
        The BECE and WASSCE outlook is part of a higher package. Terminal reports and broadsheets
        stay available — ask whoever manages your subscription about an upgrade.
      </Notice>
    );
  }
  const candidates = structure.classes.filter(
    (c) => ['JHS', 'SHS'].includes(c.category) && c.studentCount > 0,
  );
  const classId = one(params.classId) ?? candidates[0]?.id;
  const termId = me.currentTerm?.id;
  if (!classId || !termId) {
    return (
      <Notice>
        The outlook needs a running term and at least one JHS or SHS class with students.
      </Notice>
    );
  }

  const data = await api<Outlook>(`/assessment/outlook?classId=${classId}&termId=${termId}`);

  return (
    <div>
      <div className="rise rise-1 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/reports" className="text-[13px] text-oat hover:text-brand transition">
            ← Back to reports
          </Link>
          <h1 className="font-display text-3xl mt-3">
            {data.kind === 'JHS' ? 'BECE aggregate projection' : 'WASSCE readiness'}
          </h1>
          <p className="text-sm text-oat mt-1.5">
            {data.className} · {data.termName ?? 'this term'} — projected from term marks onto the
            examiners&apos; own bands. A planning tool, not a prophecy.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {candidates.map((c) => (
            <Link
              key={c.id}
              href={`/reports/outlook?classId=${c.id}`}
              className={`min-h-9 inline-flex items-center rounded-full border px-3.5 text-[13px] transition ${
                c.id === classId
                  ? 'border-brand bg-brand text-white'
                  : 'border-mist text-oat hover:border-brand'
              }`}
            >
              {c.name}
            </Link>
          ))}
        </div>
      </div>

      <div className="card mt-6 overflow-x-auto rise rise-2 table-stack-wrap">
        <table className="w-full text-sm table-stack">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <th className="px-5 py-3 font-medium">Student</th>
              {data.kind === 'JHS' ? (
                <>
                  <th className="px-5 py-3 font-medium">Projected aggregate</th>
                  <th className="px-5 py-3 font-medium">Standing</th>
                </>
              ) : (
                <>
                  <th className="px-5 py-3 font-medium">Best-six points</th>
                  <th className="px-5 py-3 font-medium">Credits</th>
                  <th className="px-5 py-3 font-medium">English &amp; Maths</th>
                  <th className="px-5 py-3 font-medium">Readiness</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {data.students.map((s) => (
              <tr key={s.id} className="border-b border-mist/50 last:border-0">
                <td className="px-5 py-3" data-label="Student">
                  <span className="font-medium">{s.name}</span>
                  <span className="block text-[11px] text-oat tabular">{s.admissionNo}</span>
                </td>
                {data.kind === 'JHS' ? (
                  <>
                    <td className="px-5 py-3 tabular" data-label="Projected aggregate">
                      {(s as JhsStudent).aggregate ?? '—'}
                    </td>
                    <td className="px-5 py-3" data-label="Standing">
                      {(() => {
                        const j = s as JhsStudent;
                        if (j.aggregate === null) return <span className="text-oat">{j.gap}</span>;
                        if (j.aggregate <= 15)
                          return <span className="text-leaf font-medium">Strong</span>;
                        if (j.aggregate <= 30)
                          return <span className="text-gold font-medium">On track</span>;
                        return <span className="text-clay font-medium">Needs attention</span>;
                      })()}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-5 py-3 tabular" data-label="Best-six points">
                      {(s as ShsStudent).aggregate ?? '—'}
                    </td>
                    <td className="px-5 py-3 tabular" data-label="Credits">
                      {(s as ShsStudent).credits}
                    </td>
                    <td className="px-5 py-3" data-label="English & Maths">
                      {(s as ShsStudent).englishCredit && (s as ShsStudent).mathsCredit ? (
                        <span className="text-leaf">both at credit</span>
                      ) : (
                        <span className="text-clay">
                          {!(s as ShsStudent).englishCredit && 'English below credit'}
                          {!(s as ShsStudent).englishCredit &&
                            !(s as ShsStudent).mathsCredit &&
                            ' · '}
                          {!(s as ShsStudent).mathsCredit && 'Maths below credit'}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3" data-label="Readiness">
                      {(s as ShsStudent).ready ? (
                        <span className="text-leaf font-medium">Ready</span>
                      ) : (
                        <span className="text-clay font-medium">Not yet</span>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
            {data.students.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-oat">
                  No computed results for this class and term yet — generate reports first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
