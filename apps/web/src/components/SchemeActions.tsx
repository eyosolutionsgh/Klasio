'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, useAsyncAction } from './Button';
import { EditIcon, PlusIcon, SaveIcon, TrashIcon } from './icons';

export interface Band {
  min: number;
  max: number;
  grade: string;
  remark: string;
}
export interface Scheme {
  id: string;
  name: string;
  kind: string;
  bands: Band[];
}

const field =
  'min-h-11 rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

const errorText = (body: { message?: string | string[] }, fallback: string) =>
  Array.isArray(body.message) ? body.message.join('. ') : (body.message ?? fallback);

const KINDS = [
  { value: 'GES_CLASSIC', label: 'GES classic' },
  { value: 'NACCA_BANDS', label: 'NaCCA proficiency bands' },
  { value: 'EARLY_YEARS', label: 'Early-years observation' },
];

/**
 * Change or remove a grading scheme.
 *
 * A scheme's bands decide the grade printed against every subject on every report card, so a
 * mistyped ceiling is not a cosmetic problem — and until now the only way to correct one was to
 * delete the scheme and build it again, which detached it from the levels using it.
 *
 * The bands are edited as rows rather than the shorthand the add form takes, because a band also
 * carries the remark that prints beside the grade. The shorthand cannot express it, and an edit
 * screen that could not see it would quietly wipe it on the first save.
 *
 * The 0–100 coverage rule lives on the server (`common/grading.ts`) and stays there — this sends
 * what was typed and shows the sentence that comes back, which names the two bands at fault.
 */
export default function SchemeActions({
  scheme,
  usedBy,
  onDone,
}: {
  scheme: Scheme;
  /** Names of the levels currently pointing at this scheme — what a removal would strand. */
  usedBy: string[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(scheme.name);
  const [kind, setKind] = useState(scheme.kind);
  const [bands, setBands] = useState<Band[]>([]);

  useEffect(() => setMounted(true), []);

  function start() {
    setName(scheme.name);
    setKind(scheme.kind);
    // Lowest band first, which is how a grading table is read, and how the gaps show up.
    setBands(
      [...(scheme.bands ?? [])]
        .sort((a, b) => a.min - b.min)
        .map((b) => ({ ...b, remark: b.remark ?? '' })),
    );
    setError(null);
    setConfirming(false);
    setOpen(true);
  }

  function setBand(i: number, patch: Partial<Band>) {
    setBands((rows) => rows.map((b, x) => (x === i ? { ...b, ...patch } : b)));
  }

  const save = useAsyncAction(async () => {
    setError(null);
    // The PATCH route validates against the full scheme DTO, so all three fields go every time.
    const res = await fetch(`/api/proxy/assessment/schemes/${scheme.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        kind,
        bands: bands.map((b) => ({
          min: Number(b.min),
          max: Number(b.max),
          grade: b.grade.trim(),
          remark: b.remark.trim(),
        })),
      }),
    });
    if (!res.ok) {
      setError(errorText(await res.json().catch(() => ({})), 'Could not save that scheme.'));
      throw new Error('rejected');
    }
    setOpen(false);
    onDone();
  });

  const remove = useAsyncAction(async () => {
    setError(null);
    const res = await fetch(`/api/proxy/assessment/schemes/${scheme.id}`, { method: 'DELETE' });
    if (!res.ok) {
      // The API refuses while any level still points here, and says so. That refusal is the
      // whole answer, so it is shown as it arrives rather than guessed at beforehand.
      setError(errorText(await res.json().catch(() => ({})), 'Could not remove that scheme.'));
      throw new Error('rejected');
    }
    setConfirming(false);
    onDone();
  });

  const controls = (
    <span className="flex items-center gap-1 shrink-0">
      {/* Both merely open something — the work happens in the dialog and the confirmation, so
          neither carries an action state here. */}
      <Button type="button" variant="ghost" size="sm" icon={<EditIcon />} onClick={start}>
        Change
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon={<TrashIcon />}
        onClick={() => {
          setConfirming(true);
          setError(null);
        }}
      >
        Remove
      </Button>
    </span>
  );

  if (confirming) {
    return (
      <div className="text-[12.5px] text-oat">
        <p className="max-w-md">
          {usedBy.length > 0 ? (
            <>
              <strong className="text-ink">{usedBy.join(', ')}</strong>{' '}
              {usedBy.length === 1 ? 'grades with' : 'grade with'} this scheme. It cannot be removed
              until {usedBy.length === 1 ? 'that level is' : 'those levels are'} pointed at another
              one — nothing is unassigned behind your back.
            </>
          ) : (
            <>
              Remove {scheme.name}? No level uses it, so no terminal report changes. Reports already
              generated keep the grades they were built with.
            </>
          )}
        </p>
        <div className="flex items-center gap-3 mt-1">
          <Button
            type="button"
            onClick={remove.run}
            state={remove.state}
            variant="danger"
            icon={<TrashIcon />}
          >
            Remove
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
          >
            Keep it
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger mt-1">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (!open || !mounted) return controls;

  return (
    <>
      {controls}
      {createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Change ${scheme.name}`}
          className="brand-scope fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <form
            onSubmit={save.run}
            className="card w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto"
          >
            <h2 className="font-display text-2xl">Change grading scheme</h2>
            <p className="text-sm text-oat mt-1.5">
              These bands turn a total into the grade and remark printed on every terminal report
              produced from now on.{' '}
              {usedBy.length > 0
                ? `${usedBy.join(', ')} ${usedBy.length === 1 ? 'grades' : 'grade'} with this scheme.`
                : 'No level uses it yet.'}{' '}
              Reports already generated keep the grades they were built with until they are
              regenerated.
            </p>

            <div className="flex flex-wrap gap-2 mt-5">
              <label className="text-[13px]">
                <span className="block text-oat mb-1">Scheme name</span>
                <input
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={`${field} w-56`}
                />
              </label>
              <label className="text-[13px]">
                <span className="block text-oat mb-1">Kind</span>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className={`${field} w-56`}
                >
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Four inputs a row will not fit a handset side by side, so below `sm` each band
                becomes its own labelled card. The 560px floor has to be `sm:` — left
                unconditional it would push the dialog itself wider than the screen. */}
            <div className="mt-5 overflow-x-auto table-stack-wrap">
              <table className="w-full text-sm sm:min-w-[560px] table-stack">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist">
                    <th className="py-2 pr-3 font-medium">From</th>
                    <th className="py-2 pr-3 font-medium">To</th>
                    <th className="py-2 pr-3 font-medium">Grade</th>
                    <th className="py-2 pr-3 font-medium">Remark on the report</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {bands.map((b, i) => (
                    <tr key={i} className="border-b border-mist/50 last:border-0">
                      <td data-label="From" className="py-2 pr-3">
                        <input
                          required
                          type="number"
                          min="0"
                          max="100"
                          value={b.min}
                          onChange={(e) => setBand(i, { min: Number(e.target.value) })}
                          className={`${field} w-20 tabular`}
                        />
                      </td>
                      <td data-label="To" className="py-2 pr-3">
                        <input
                          required
                          type="number"
                          min="0"
                          max="100"
                          value={b.max}
                          onChange={(e) => setBand(i, { max: Number(e.target.value) })}
                          className={`${field} w-20 tabular`}
                        />
                      </td>
                      <td data-label="Grade" className="py-2 pr-3">
                        <input
                          required
                          value={b.grade}
                          onChange={(e) => setBand(i, { grade: e.target.value })}
                          placeholder="A"
                          className={`${field} w-20`}
                        />
                      </td>
                      <td data-label="Remark on the report" className="py-2 pr-3">
                        <input
                          value={b.remark}
                          onChange={(e) => setBand(i, { remark: e.target.value })}
                          placeholder="Excellent"
                          className={`${field} w-full`}
                        />
                      </td>
                      <td className="py-2 text-right">
                        {/* Only drops the row from the draft — nothing is saved until the form
                            is submitted, so this stays ghost rather than danger. */}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          icon={<TrashIcon />}
                          onClick={() => setBands((rows) => rows.filter((_, x) => x !== i))}
                          aria-label={`Remove the ${b.grade || 'unnamed'} band`}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {bands.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-xs text-oat">
                        No bands. Add one — together they must cover 0 to 100.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<PlusIcon />}
              className="mt-3"
              onClick={() => {
                // Start the next band one above the highest ceiling so far, which is how a table
                // is written out and saves retyping the number just entered.
                const top = bands.reduce((n, b) => Math.max(n, Number(b.max)), -1);
                setBands([
                  ...bands,
                  { min: Math.min(top + 1, 100), max: 100, grade: '', remark: '' },
                ]);
              }}
            >
              Add a band
            </Button>

            {error && (
              <p
                role="alert"
                className="mt-4 text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2"
              >
                {error}
              </p>
            )}

            <p className="mt-4 rounded-lg bg-parchment/60 px-3.5 py-3 text-xs text-oat">
              <strong className="text-ink">Every score needs exactly one grade.</strong> The bands
              are checked when you save: they must start at 0, reach 100, and neither leave a gap
              nor overlap. If they do not, the scheme is refused and the two bands at fault are
              named — nothing is saved half-changed.
            </p>

            <div className="flex items-center gap-3 mt-5">
              <Button type="submit" state={save.state} icon={<SaveIcon />}>
                Save scheme
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </div>,
        document.body,
      )}
    </>
  );
}
