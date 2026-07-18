'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Me {
  student: { name: string; admissionNo: string; className: string | null };
  school: { name: string; phone: string | null; currency: string };
  feeBalance: number;
  attendance: Record<string, number>;
  reports: {
    termId: string;
    term: string;
    year: string;
    overallTotal: number;
    classPosition: number | null;
    classSize: number | null;
  }[];
}
interface Notice {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });

export default function StudentPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/student/student/me');
      if (res.status === 401) {
        router.push('/student/login');
        return;
      }
      setMe(await res.json());
      const n = await fetch('/api/student/student/notices');
      if (n.ok) setNotices(await n.json());
    })();
  }, [router]);

  async function signOut() {
    await fetch('/api/student-session', { method: 'DELETE' });
    router.push('/student/login');
  }

  if (!me) {
    return <main className="min-h-dvh flex items-center justify-center text-oat">Loading…</main>;
  }

  const att = me.attendance;
  const total = Object.values(att).reduce((a, b) => a + b, 0);
  const money = (n: number) =>
    `${me.school.currency} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2 })}`;

  return (
    <main className="min-h-dvh">
      <header className="bg-forest-deep text-paper pt-[env(safe-area-inset-top)]">
        <div className="kente-stripe h-1.5" />
        <div className="max-w-3xl mx-auto px-5 py-5 flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-xl text-gold leading-none">{me.school.name}</p>
            <p className="text-[13px] text-paper/70 mt-1.5">
              {me.student.name} · {me.student.admissionNo}
              {me.student.className && ` · ${me.student.className}`}
            </p>
          </div>
          <button
            onClick={signOut}
            className="shrink-0 -mr-2 -mt-1 min-h-11 px-2 text-[13px] text-paper/70 hover:text-gold transition underline underline-offset-2"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-5 py-6 space-y-6">
        <section className="card p-6">
          <h2 className="font-display text-xl">My attendance</h2>
          <div className="mt-4 grid grid-cols-4 gap-3 text-center">
            {(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as const).map((k) => (
              <div key={k} className="rounded-lg bg-parchment/60 py-3">
                <p className="font-display text-xl tabular">{att[k] ?? 0}</p>
                <p className="text-[10px] uppercase tracking-wider text-oat mt-1">
                  {k.toLowerCase()}
                </p>
              </div>
            ))}
          </div>
          {total > 0 && (
            <p className="text-xs text-oat mt-3">
              {Math.round((((att.PRESENT ?? 0) + (att.LATE ?? 0)) / total) * 100)}% across {total}{' '}
              marked days
            </p>
          )}
        </section>

        <section className="card p-6">
          <h2 className="font-display text-xl">My results</h2>
          {me.reports.length === 0 ? (
            <p className="text-sm text-oat mt-2">
              No report cards have been released yet. They appear here once the school publishes
              them.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {me.reports.map((r) => (
                <li key={r.termId} className="border-b border-mist/50 last:border-0 pb-3 last:pb-0">
                  <p className="font-medium text-sm">
                    {r.term} · {r.year}
                  </p>
                  <p className="text-[11px] text-oat tabular">
                    Total {r.overallTotal.toFixed(1)}
                    {r.classPosition && ` · position ${r.classPosition} of ${r.classSize}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-6">
          <h2 className="font-display text-xl">My fees</h2>
          <p
            className={`font-display text-3xl tabular mt-2 ${me.feeBalance > 0 ? 'text-clay' : 'text-leaf'}`}
          >
            {money(me.feeBalance)}
          </p>
          <p className="text-xs text-oat mt-1">
            {me.feeBalance > 0 ? 'Outstanding on your account.' : 'Fully paid — thank you.'}
          </p>
        </section>

        <section className="card p-6">
          <h2 className="font-display text-xl">School notices</h2>
          <ul className="mt-4 space-y-4">
            {notices.map((n) => (
              <li key={n.id} className="border-b border-mist/50 last:border-0 pb-3 last:pb-0">
                <p className="font-medium text-sm">{n.title}</p>
                <p className="text-[11px] text-oat">{fmtDate(n.publishedAt)}</p>
                <p className="text-sm mt-1.5">{n.body}</p>
              </li>
            ))}
            {notices.length === 0 && <li className="text-sm text-oat">No notices yet.</li>}
          </ul>
        </section>
      </div>
    </main>
  );
}
