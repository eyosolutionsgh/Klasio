'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Ward {
  id: string;
  name: string;
  admissionNo: string;
  className: string | null;
}
interface Me {
  guardian: { name: string };
  school: { name: string; phone: string | null; currency: string };
  wards: Ward[];
}
interface Overview {
  student: { name: string; admissionNo: string; className: string | null };
  feeBalance: number;
  ledger: {
    id: string;
    type: string;
    amount: number;
    method: string | null;
    reference: string;
    receiptNumber: string | null;
    createdAt: string;
  }[];
  attendance: Record<string, number>;
}
interface ReportRow {
  termId: string;
  term: string;
  year: string;
  overallTotal: number;
  classPosition: number | null;
  classSize: number | null;
}
interface Notice {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });

export default function FamilyPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [wardId, setWardId] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);

  const money = (n: number) =>
    `${me?.school.currency ?? 'GHS'} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/family/guardian/me');
      if (res.status === 401) {
        router.push('/family/login');
        return;
      }
      const d: Me = await res.json();
      setMe(d);
      if (d.wards[0]) setWardId(d.wards[0].id);
      const n = await fetch('/api/family/guardian/notices');
      if (n.ok) setNotices(await n.json());
      setLoading(false);
    })();
  }, [router]);

  const loadWard = useCallback(async () => {
    if (!wardId) return;
    const [o, r] = await Promise.all([
      fetch(`/api/family/guardian/wards/${wardId}`).then((x) => (x.ok ? x.json() : null)),
      fetch(`/api/family/guardian/wards/${wardId}/reports`).then((x) => (x.ok ? x.json() : [])),
    ]);
    setOverview(o);
    setReports(Array.isArray(r) ? r : []);
  }, [wardId]);

  useEffect(() => {
    loadWard();
  }, [loadWard]);

  async function signOut() {
    await fetch('/api/guardian-session', { method: 'DELETE' });
    router.push('/family/login');
  }

  if (loading || !me) {
    return <main className="min-h-screen flex items-center justify-center text-oat">Loading…</main>;
  }

  const att = overview?.attendance ?? {};
  const attTotal = Object.values(att).reduce((a, b) => a + b, 0);

  return (
    <main className="min-h-screen">
      <header className="bg-forest-deep text-paper">
        <div className="kente-stripe h-1.5" />
        <div className="max-w-3xl mx-auto px-5 py-5 flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-xl text-gold leading-none">{me.school.name}</p>
            <p className="text-[13px] text-paper/70 mt-1.5">Welcome, {me.guardian.name}</p>
          </div>
          <button
            onClick={signOut}
            className="text-[12px] text-paper/60 hover:text-gold transition underline underline-offset-2"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-5 py-6 space-y-6">
        {me.wards.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {me.wards.map((w) => (
              <button
                key={w.id}
                onClick={() => setWardId(w.id)}
                className={`text-[13px] rounded-full px-3.5 py-1.5 border transition ${wardId === w.id ? 'bg-forest text-paper border-forest' : 'border-mist bg-white hover:border-forest'}`}
              >
                {w.name}
              </button>
            ))}
          </div>
        )}

        {overview && (
          <>
            <section className="card p-6">
              <p className="font-display text-2xl">{overview.student.name}</p>
              <p className="text-sm text-oat mt-1 tabular">
                {overview.student.admissionNo}
                {overview.student.className && ` · ${overview.student.className}`}
              </p>
              <div className="mt-5 rounded-lg bg-parchment/70 p-5 text-center">
                <p className="text-[11px] uppercase tracking-widest text-oat">Fees outstanding</p>
                <p
                  className={`font-display text-3xl tabular mt-1 ${overview.feeBalance > 0 ? 'text-clay' : 'text-leaf'}`}
                >
                  {money(overview.feeBalance)}
                </p>
                {overview.feeBalance <= 0 && (
                  <p className="text-xs text-leaf mt-1">Fully paid — thank you.</p>
                )}
              </div>
            </section>

            <section className="card p-6">
              <h2 className="font-display text-xl">Attendance</h2>
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
              {attTotal > 0 && (
                <p className="text-xs text-oat mt-3">
                  {Math.round((((att.PRESENT ?? 0) + (att.LATE ?? 0)) / attTotal) * 100)}% across{' '}
                  {attTotal} marked days
                </p>
              )}
            </section>

            <section className="card p-6">
              <h2 className="font-display text-xl">Report cards</h2>
              {reports.length === 0 ? (
                <p className="text-sm text-oat mt-2">
                  No report cards have been released yet. They appear here once the school publishes
                  them.
                </p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {reports.map((r) => (
                    <li
                      key={r.termId}
                      className="flex items-center justify-between border-b border-mist/50 last:border-0 pb-3 last:pb-0"
                    >
                      <div>
                        <p className="font-medium text-sm">
                          {r.term} · {r.year}
                        </p>
                        <p className="text-[11px] text-oat tabular">
                          Total {r.overallTotal.toFixed(1)}
                          {r.classPosition && ` · position ${r.classPosition} of ${r.classSize}`}
                        </p>
                      </div>
                      <a
                        href={`/api/family/guardian/wards/${wardId}/reports/${r.termId}/pdf`}
                        className="text-[13px] font-medium text-forest border border-forest/40 rounded-full px-3.5 py-1.5 hover:bg-forest-mist transition"
                      >
                        Download PDF
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card p-6">
              <h2 className="font-display text-xl">Bills &amp; payments</h2>
              <ul className="mt-4 space-y-3">
                {overview.ledger.map((e) => (
                  <li
                    key={e.id}
                    className="flex justify-between gap-3 text-sm border-b border-mist/50 last:border-0 pb-2.5 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {e.type === 'INVOICE'
                          ? 'School bill'
                          : e.type === 'PAYMENT'
                            ? `Payment${e.method ? ` · ${e.method}` : ''}`
                            : e.type}
                      </p>
                      <p className="text-[11px] text-oat tabular">
                        {fmtDate(e.createdAt)}
                        {e.receiptNumber && ` · receipt ${e.receiptNumber}`}
                      </p>
                    </div>
                    <p
                      className={`tabular font-medium shrink-0 ${e.type === 'INVOICE' ? 'text-ink' : 'text-leaf'}`}
                    >
                      {e.type === 'INVOICE' ? '' : '−'}
                      {money(e.amount)}
                    </p>
                  </li>
                ))}
                {overview.ledger.length === 0 && (
                  <li className="text-sm text-oat">Nothing billed yet.</li>
                )}
              </ul>
            </section>
          </>
        )}

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

        <p className="text-[11px] text-oat text-center pb-4">
          Questions? Call the school{me.school.phone ? ` on ${me.school.phone}` : ''}.
        </p>
      </div>
    </main>
  );
}
