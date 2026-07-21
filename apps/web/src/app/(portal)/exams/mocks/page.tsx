'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, useAsyncAction } from '@/components/Button';
import { PlusIcon } from '@/components/icons';

/**
 * Mock examinations: the three-to-six rehearsals a candidate class sits in its final year.
 *
 * Reported the way a school talks about them — in BECE aggregates, and against the last mock,
 * because "aggregate 14, up from 19" is the sentence a head says to a parent. Improvement is shown
 * as a positive number even though the aggregate itself falls, since a column of negative numbers
 * meaning "better" gets read backwards.
 */
interface Series {
  id: string;
  name: string;
  year: string;
  sittingOn: string | null;
  marksRecorded: number;
}

interface Candidate {
  studentId: string;
  name: string;
  admissionNo: string;
  aggregate: number | null;
  gap: string | null;
  subjects: { subject: string; total: number; grade: number }[];
}

interface Results {
  series: { id: string; name: string; year: string };
  candidates: Candidate[];
  bestAggregate: number | null;
  averageAggregate: number | null;
  candidatesWithAggregate: number;
  candidatesTotal: number;
}

const field =
  'rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

export default function MocksPage() {
  const [series, setSeries] = useState<Series[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [results, setResults] = useState<Results | null>(null);
  const [compareWith, setCompareWith] = useState('');
  const [comparison, setComparison] = useState<
    { studentId: string; name: string; was: number | null; now: number | null; improvedBy: number | null }[] | null
  >(null);
  const [name, setName] = useState('');
  const [sittingOn, setSittingOn] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadSeries = useCallback(async () => {
    const res = await fetch('/api/proxy/mocks');
    if (!res.ok) return;
    const rows: Series[] = await res.json();
    setSeries(rows);
    if (!selected && rows[0]) setSelected(rows[0].id);
  }, [selected]);

  useEffect(() => {
    loadSeries();
  }, [loadSeries]);

  useEffect(() => {
    if (!selected) return;
    setComparison(null);
    fetch(`/api/proxy/mocks/${selected}/results`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setResults)
      .catch(() => {});
  }, [selected]);

  const create = useAsyncAction(async () => {
    setError(null);
    const res = await fetch('/api/proxy/mocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, sittingOn: sittingOn || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message ?? 'Could not create that series.');
      throw new Error('rejected');
    }
    setName('');
    setSittingOn('');
    setSelected(data.id);
    loadSeries();
  });

  async function compare(otherId: string) {
    setCompareWith(otherId);
    if (!otherId) {
      setComparison(null);
      return;
    }
    const res = await fetch(`/api/proxy/mocks/${selected}/compare/${otherId}`);
    if (res.ok) setComparison((await res.json()).rows);
  }

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Mock examinations</h1>
        <p className="text-sm text-oat mt-1.5 max-w-prose">
          A mock is its own thing — not a term, and not part of the terminal report. Each series
          keeps its own marks and is scored as BECE is: four core subjects plus the best two
          electives.{' '}
          <Link href="/reports/outlook" className="text-brand underline underline-offset-2">
            BECE &amp; WASSCE outlook →
          </Link>
        </p>
      </div>

      <form onSubmit={create.run} className="card p-5 mt-6 rise rise-2 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[12rem]">
          <span className="text-xs uppercase tracking-widest text-oat">New series</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            placeholder="Mock 2"
            className={`${field} mt-1.5 w-full`}
          />
        </label>
        <label>
          <span className="text-xs uppercase tracking-widest text-oat">Sat on</span>
          <input
            type="date"
            value={sittingOn}
            onChange={(e) => setSittingOn(e.target.value)}
            className={`${field} mt-1.5 block`}
          />
        </label>
        <Button type="submit" state={create.state} icon={<PlusIcon />}>
          Create series
        </Button>
        {error && (
          <p role="alert" className="w-full text-xs text-danger">
            {error}
          </p>
        )}
      </form>

      {series.length > 0 && (
        <div className="mt-6 flex flex-wrap items-end gap-3 rise rise-2">
          <label>
            <span className="text-xs uppercase tracking-widest text-oat">Series</span>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className={`${field} mt-1.5 block`}
            >
              {series.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.year} ({s.marksRecorded} marks)
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-xs uppercase tracking-widest text-oat">Compare with</span>
            <select
              value={compareWith}
              onChange={(e) => compare(e.target.value)}
              className={`${field} mt-1.5 block`}
            >
              <option value="">—</option>
              {series
                .filter((s) => s.id !== selected)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          {selected && (
            <a
              href={`/api/proxy/mocks/${selected}/results.csv`}
              className="inline-flex items-center min-h-11 rounded-lg border border-mist px-4 text-sm font-medium text-brand hover:bg-brand-mist/40 transition"
            >
              Export CSV
            </a>
          )}
        </div>
      )}

      {results && !comparison && (
        <div className="card p-6 mt-6 rise rise-3">
          <p className="text-sm text-oat">
            {results.candidatesWithAggregate} of {results.candidatesTotal} candidates have a full
            aggregate · best {results.bestAggregate ?? '—'} · average{' '}
            {results.averageAggregate ?? '—'}
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm table-stack">
              <thead className="text-left text-[11px] uppercase tracking-widest text-oat">
                <tr>
                  <th className="py-2 pr-3">Candidate</th>
                  <th className="py-2 pr-3">Aggregate</th>
                  <th className="py-2">Subjects</th>
                </tr>
              </thead>
              <tbody>
                {results.candidates.map((c) => (
                  <tr key={c.studentId} className="border-t border-mist/60">
                    <td className="py-2 pr-3" data-label="Candidate">
                      <span className="font-medium">{c.name}</span>{' '}
                      <span className="text-oat text-xs tabular">{c.admissionNo}</span>
                    </td>
                    <td className="py-2 pr-3 tabular" data-label="Aggregate">
                      {c.aggregate ?? <span className="text-clay text-xs">{c.gap}</span>}
                    </td>
                    <td className="py-2 text-xs text-oat" data-label="Subjects">
                      {c.subjects.map((s) => `${s.subject} ${s.grade}`).join(' · ')}
                    </td>
                  </tr>
                ))}
                {results.candidates.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-3 text-sm text-oat">
                      No marks entered for this series yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {comparison && (
        <div className="card p-6 mt-6 rise rise-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-stack">
              <thead className="text-left text-[11px] uppercase tracking-widest text-oat">
                <tr>
                  <th className="py-2 pr-3">Candidate</th>
                  <th className="py-2 pr-3">Was</th>
                  <th className="py-2 pr-3">Now</th>
                  <th className="py-2">Change</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((r) => (
                  <tr key={r.studentId} className="border-t border-mist/60">
                    <td className="py-2 pr-3 font-medium" data-label="Candidate">
                      {r.name}
                    </td>
                    <td className="py-2 pr-3 tabular" data-label="Was">
                      {r.was ?? '—'}
                    </td>
                    <td className="py-2 pr-3 tabular" data-label="Now">
                      {r.now ?? '—'}
                    </td>
                    <td className="py-2 tabular" data-label="Change">
                      {r.improvedBy === null ? (
                        '—'
                      ) : r.improvedBy > 0 ? (
                        <span className="text-leaf">{r.improvedBy} better</span>
                      ) : r.improvedBy < 0 ? (
                        <span className="text-danger">{Math.abs(r.improvedBy)} worse</span>
                      ) : (
                        <span className="text-oat">no change</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
