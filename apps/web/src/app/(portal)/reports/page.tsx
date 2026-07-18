'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface ReportRow {
  studentId: string;
  name: string;
  admissionNo: string;
  overallTotal: number;
  classPosition: number | null;
  classSize: number | null;
}
interface ClassOpt {
  id: string;
  name: string;
  studentCount: number;
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

export default function ReportsPage() {
  const [classes, setClasses] = useState<ClassOpt[]>([]);
  const [classId, setClassId] = useState('');
  const [termId, setTermId] = useState('');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/proxy/school/structure').then((r) => r.json()),
      fetch('/api/proxy/me').then((r) => r.json()),
    ]).then(([s, me]) => {
      const withStudents = s.classes.filter((c: ClassOpt) => c.studentCount > 0);
      setClasses(withStudents);
      if (withStudents[0]) setClassId(withStudents[0].id);
      if (me.currentTerm) setTermId(me.currentTerm.id);
    });
  }, []);

  const load = useCallback(async () => {
    if (!classId || !termId) return;
    const res = await fetch(`/api/proxy/assessment/reports?classId=${classId}&termId=${termId}`);
    setRows(await res.json());
  }, [classId, termId]);

  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/proxy/assessment/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId, termId }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMessage(
        `Generated ${body.generated} report${body.generated === 1 ? '' : 's'} for this class.`,
      );
      load();
    } else {
      setMessage(body.message ?? 'Could not generate reports.');
    }
  }

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Terminal reports</h1>
        <p className="text-sm text-oat mt-1.5">
          Computes SBA (30%) + exam (70%), GES grades, subject and class positions from saved
          scores.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 rise rise-2">
        <select
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          aria-label="Class"
          className="rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-forest"
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          onClick={generate}
          disabled={busy || !classId}
          data-tip="Recomputes every report in this class from the latest scores"
          className="tip rounded-lg bg-forest text-paper text-sm font-medium px-5 py-2 hover:bg-forest-deep transition disabled:opacity-50"
        >
          {busy ? 'Computing…' : 'Generate reports'}
        </button>
        {message && <p className="text-sm text-oat">{message}</p>}
      </div>

      <div className="card mt-6 overflow-hidden rise rise-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <th className="px-5 py-3 font-medium">Position</th>
              <th className="px-5 py-3 font-medium">Student</th>
              <th className="px-5 py-3 font-medium text-right">Overall total</th>
              <th className="px-5 py-3 font-medium text-right">Report</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.studentId}
                className="border-b border-mist/60 last:border-0 hover:bg-parchment/40 transition"
              >
                <td className="px-5 py-3">
                  <span
                    className={`font-display text-lg tabular ${r.classPosition === 1 ? 'text-gold' : 'text-ink'}`}
                  >
                    {r.classPosition ? ordinal(r.classPosition) : '—'}
                  </span>
                  <span className="text-oat text-xs"> / {r.classSize}</span>
                </td>
                <td className="px-5 py-3">
                  <p className="font-medium">{r.name}</p>
                  <p className="text-[11px] text-oat tabular">{r.admissionNo}</p>
                </td>
                <td className="px-5 py-3 text-right tabular font-medium">
                  {r.overallTotal.toFixed(1)}
                </td>
                <td className="px-5 py-3 text-right">
                  <Link
                    href={`/reports/${r.studentId}/${termId}`}
                    className="text-forest font-medium text-[13px] hover:underline underline-offset-2"
                  >
                    View report card →
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-oat">
                  No reports yet for this class — enter scores, then press “Generate reports”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
