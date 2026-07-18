'use client';

import { useEffect, useState } from 'react';

interface TermRow {
  termId: string;
  term: string;
  year: string;
  className: string;
  subjects: number;
  overallTotal: number;
  average: number;
  classPosition: number | null;
  classSize: number | null;
  attendancePresent: number | null;
  attendanceTotal: number | null;
  published: boolean;
}
interface Cumulative {
  student: { name: string; admissionNo: string; className: string | null };
  terms: TermRow[];
  cumulativeAverage: number;
  trend: number | null;
  termsRecorded: number;
  classesAttended: string[];
}

/**
 * The child's whole record, earliest term first — the cumulative record card a school keeps
 * from the day a child arrives. A single term says little; the shape across classes is what a
 * teacher and a parent actually want to see.
 */
export default function CumulativeRecord({ studentId }: { studentId: string }) {
  const [data, setData] = useState<Cumulative | null>(null);

  useEffect(() => {
    fetch(`/api/proxy/assessment/cumulative/${studentId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData);
  }, [studentId]);

  if (!data || data.termsRecorded === 0) return null;

  const best = Math.max(...data.terms.map((t) => t.average), 1);

  return (
    <section className="card p-6 rise rise-3">
      <h2 className="font-display text-xl">Cumulative record</h2>
      <p className="text-sm text-oat mt-1.5">
        {data.termsRecorded} term{data.termsRecorded === 1 ? '' : 's'} across{' '}
        {data.classesAttended.join(', ')}.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-6">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-oat">Cumulative average</p>
          <p className="font-display text-3xl tabular">{data.cumulativeAverage}</p>
        </div>
        {data.trend !== null && (
          <div>
            <p className="text-[11px] uppercase tracking-widest text-oat">Since last term</p>
            <p
              className={`font-display text-2xl tabular ${
                data.trend > 0 ? 'text-leaf' : data.trend < 0 ? 'text-clay' : 'text-oat'
              }`}
            >
              {data.trend > 0 ? '+' : ''}
              {data.trend}
            </p>
          </div>
        )}
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-sm min-w-[440px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist">
              <th className="py-2 font-medium">Term</th>
              <th className="py-2 font-medium">Class</th>
              <th className="py-2 font-medium text-right">Average</th>
              <th className="py-2 font-medium text-right">Position</th>
              <th className="py-2 font-medium">Progress</th>
            </tr>
          </thead>
          <tbody>
            {data.terms.map((t) => (
              <tr key={t.termId} className="border-b border-mist/50 last:border-0">
                <td className="py-2.5">
                  {t.term}
                  <span className="block text-[11px] text-oat">{t.year}</span>
                </td>
                <td className="py-2.5">{t.className}</td>
                <td className="py-2.5 text-right tabular font-medium">{t.average}</td>
                <td className="py-2.5 text-right tabular text-oat">
                  {t.classPosition ? `${t.classPosition}/${t.classSize}` : '—'}
                </td>
                <td className="py-2.5 w-28">
                  <span className="block h-2 rounded-full bg-parchment overflow-hidden">
                    <span
                      className="block h-full bg-brand"
                      style={{ width: `${Math.round((t.average / best) * 100)}%` }}
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-oat mt-3">
        Averages are per subject, so terms with different numbers of subjects stay comparable.
      </p>
    </section>
  );
}
