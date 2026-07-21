'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, useAsyncAction } from './Button';

/**
 * A BECE candidate's ranked list of senior high schools.
 *
 * The choices are made before the exam and administered by the JHS, so the school holds them — on
 * paper, until now, which is where they get lost and mis-ranked. 2026 raised the list from seven
 * to eight and added rules about categories, and a paper form gets that wrong quietly.
 *
 * Saved as a whole list rather than row by row: reordering choices three and five is one decision,
 * and applying it as two edits leaves a moment where two schools share a position.
 */
interface Choice {
  rank: number;
  schoolName: string;
  programme: string | null;
  category: string | null;
  residency: string | null;
}

const EMPTY: Omit<Choice, 'rank'> = {
  schoolName: '',
  programme: '',
  category: '',
  residency: '',
};

export default function CsspsChoices({ studentId }: { studentId: string }) {
  const [max, setMax] = useState(8);
  const [rows, setRows] = useState<Omit<Choice, 'rank'>[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/proxy/compliance/cssps/${studentId}`);
    if (!res.ok) return;
    const data: { maxChoices: number; choices: Choice[] } = await res.json();
    setMax(data.maxChoices);
    const next = Array.from({ length: data.maxChoices }, (_, i) => {
      const c = data.choices.find((x) => x.rank === i + 1);
      return c
        ? {
            schoolName: c.schoolName,
            programme: c.programme ?? '',
            category: c.category ?? '',
            residency: c.residency ?? '',
          }
        : { ...EMPTY };
    });
    setRows(next);
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (i: number, patch: Partial<Omit<Choice, 'rank'>>) =>
    setRows((r) => r.map((row, j) => (i === j ? { ...row, ...patch } : row)));

  const save = useAsyncAction(async () => {
    setError(null);
    // Only the filled rows are sent; a blank line is an unchosen position, not an empty school.
    const choices = rows
      .map((r, i) => ({ ...r, rank: i + 1 }))
      .filter((r) => r.schoolName.trim().length > 0);
    const res = await fetch(`/api/proxy/compliance/cssps/${studentId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choices }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.message ?? 'Could not save those choices.');
      throw new Error('rejected');
    }
    load();
  });

  const filled = rows.filter((r) => r.schoolName.trim()).length;

  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl">SHS choices (CSSPS)</h2>
        <p className="text-xs text-oat">
          {filled} of {max} chosen
        </p>
      </div>
      {!open ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="text-sm text-oat">
            {filled === 0
              ? 'No choices recorded yet.'
              : rows
                  .filter((r) => r.schoolName.trim())
                  .map((r, i) => `${i + 1}. ${r.schoolName}`)
                  .join(' · ')}
          </p>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            {filled === 0 ? 'Record choices' : 'Edit choices'}
          </Button>
        </div>
      ) : (
        <form onSubmit={save.run} className="mt-4">
          <ol className="space-y-2">
            {rows.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-sm text-oat tabular">{i + 1}.</span>
                <input
                  value={r.schoolName}
                  onChange={(e) => set(i, { schoolName: e.target.value })}
                  placeholder="School"
                  aria-label={`Choice ${i + 1} school`}
                  className="flex-1 min-w-[10rem] rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                />
                <input
                  value={r.programme ?? ''}
                  onChange={(e) => set(i, { programme: e.target.value })}
                  placeholder="Programme"
                  aria-label={`Choice ${i + 1} programme`}
                  className="w-40 rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                />
                <select
                  value={r.residency ?? ''}
                  onChange={(e) => set(i, { residency: e.target.value })}
                  aria-label={`Choice ${i + 1} residency`}
                  className="rounded-lg border border-mist bg-white px-2 py-2 text-sm"
                >
                  <option value="">—</option>
                  <option value="Boarding">Boarding</option>
                  <option value="Day">Day</option>
                </select>
                <select
                  value={r.category ?? ''}
                  onChange={(e) => set(i, { category: e.target.value })}
                  aria-label={`Choice ${i + 1} category`}
                  className="rounded-lg border border-mist bg-white px-2 py-2 text-sm"
                >
                  <option value="">Cat.</option>
                  {['A', 'B', 'C', 'D'].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-oat mt-3 max-w-prose">
            Leave a line blank to leave that position unchosen. CSSPS expects the list to include
            schools across categories — an all-category-A list is the commonest reason a candidate
            goes unplaced.
          </p>
          <div className="flex items-center gap-3 mt-4">
            <Button
              type="submit"
              state={save.state}
              pendingLabel="Saving…"
              doneLabel="Saved!"
              failedLabel="Couldn't save"
            >
              Save choices
            </Button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                load();
              }}
              className="min-h-11 px-2 text-sm text-oat hover:text-brand transition"
            >
              Cancel
            </button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-danger mt-2">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
