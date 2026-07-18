'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Trends {
  markedRecords: number;
  overallRate: number;
  threshold: { rate: number; minDays: number };
  classes: { classId: string; name: string; rate: number; marked: number }[];
  chronic: {
    studentId: string;
    name: string;
    admissionNo: string;
    className: string;
    absent: number;
    total: number;
    rate: number;
  }[];
}

const bar = (rate: number) => (rate >= 90 ? 'bg-leaf' : rate >= 80 ? 'bg-gold' : 'bg-clay');

export default function AttendanceTrendsPage() {
  const [termName, setTermName] = useState('');
  const [data, setData] = useState<Trends | null>(null);

  useEffect(() => {
    fetch('/api/proxy/me')
      .then((r) => r.json())
      .then(async (me) => {
        if (!me.currentTerm) return;
        setTermName(`${me.currentTerm.academicYear?.name ?? ''} · ${me.currentTerm.name}`);
        const res = await fetch(`/api/proxy/attendance/trends?termId=${me.currentTerm.id}`);
        if (res.ok) setData(await res.json());
      });
  }, []);

  if (!data) return <p className="text-sm text-oat">Loading…</p>;

  return (
    <div>
      <div className="rise rise-1">
        <Link href="/attendance" className="text-[13px] text-oat hover:text-brand transition">
          ← Back to the register
        </Link>
        <h1 className="font-display text-3xl mt-3">Attendance patterns</h1>
        <p className="text-sm text-oat mt-1.5">
          {termName} · {data.markedRecords.toLocaleString()} marked records
        </p>
      </div>

      <div className="card p-6 mt-6 rise rise-2">
        <p className="text-[11px] uppercase tracking-widest text-oat">Attendance this term</p>
        <p className="font-display text-4xl tabular mt-1">{data.overallRate}%</p>
        <p className="text-xs text-oat mt-1">Present or late, across every marked register.</p>
      </div>

      <section className="card p-6 mt-6 rise rise-3">
        <h2 className="font-display text-xl">By class</h2>
        <p className="text-sm text-oat mt-1.5">Lowest first — where to look.</p>
        <ul className="mt-4 space-y-3">
          {data.classes.map((c) => (
            <li key={c.classId}>
              <div className="flex justify-between text-sm">
                <span>{c.name}</span>
                <span className="tabular text-oat">
                  {c.rate}% · {c.marked} marks
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-parchment overflow-hidden">
                <div className={`h-full ${bar(c.rate)}`} style={{ width: `${c.rate}%` }} />
              </div>
            </li>
          ))}
          {data.classes.length === 0 && (
            <li className="text-sm text-oat">No registers marked this term yet.</li>
          )}
        </ul>
      </section>

      <section className="card p-6 mt-6 rise rise-4">
        <h2 className="font-display text-xl">Chronic absence</h2>
        <p className="text-sm text-oat mt-1.5">
          Missing {data.threshold.rate}% or more of sessions, over at least {data.threshold.minDays}{' '}
          marked days. A child missing one day a week looks unremarkable every single morning — this
          is where it shows.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist">
                <th className="py-2 font-medium">Student</th>
                <th className="py-2 font-medium">Class</th>
                <th className="py-2 font-medium text-right">Absences</th>
                <th className="py-2 font-medium text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {data.chronic.map((c) => (
                <tr key={c.studentId} className="border-b border-mist/50 last:border-0">
                  <td className="py-2.5">
                    <Link
                      href={`/students/${c.studentId}`}
                      className="font-medium text-brand hover:underline underline-offset-2"
                    >
                      {c.name}
                    </Link>
                    <span className="block text-[11px] text-oat tabular">{c.admissionNo}</span>
                  </td>
                  <td className="py-2.5">{c.className}</td>
                  <td className="py-2.5 text-right tabular">
                    {c.absent} of {c.total}
                  </td>
                  <td className="py-2.5 text-right tabular font-medium text-clay">{c.rate}%</td>
                </tr>
              ))}
              {data.chronic.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-oat">
                    Nobody is at the chronic-absence threshold. Good.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
