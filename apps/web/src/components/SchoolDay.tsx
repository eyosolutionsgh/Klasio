'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, useAsyncAction } from './Button';
import { EditIcon, PlusIcon, SaveIcon, TrashIcon } from './icons';

export interface Period {
  id: string;
  name: string;
  isBreak: boolean;
  /** "HH:MM", as the API formats it for reading. */
  startsAt: string;
  endsAt: string;
  order: number;
}

const field =
  'w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

/** "08:00" → 480. The API counts a period in minutes from midnight; nobody types that. */
export function toMinutes(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/** 480 → "08:00", which is also the shape `<input type="time">` insists on. */
export function toTime(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

const errorText = (body: { message?: string | string[] }, fallback: string) =>
  Array.isArray(body.message) ? body.message.join('. ') : (body.message ?? fallback);

interface Draft {
  name: string;
  startsAt: string;
  endsAt: string;
  isBreak: boolean;
}

const BLANK: Draft = { name: '', startsAt: '08:00', endsAt: '08:40', isBreak: false };

/**
 * The shape of the school day: the rows every class's timetable is drawn on.
 *
 * The API owns the rules — no period may sit on top of a teaching period's time, a period that
 * still holds lessons cannot be removed or turned into a break — so this screen never second
 * guesses them. It sends the change and shows the API's own sentence back when it is refused,
 * because that sentence names the period in the way and this one could not.
 */
export default function SchoolDay({
  variant = 'link',
  label = 'Set out the school day',
  onChanged,
}: {
  variant?: 'link' | 'primary';
  label?: string;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [periods, setPeriods] = useState<Period[] | null>(null);
  /** Which row is being changed, and the values being typed into it. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState<Draft>(BLANK);
  /** The row whose removal has been asked for but not yet confirmed. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Something changed while the panel was open, so the timetable behind it is stale. */
  const [dirty, setDirty] = useState(false);

  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    const res = await fetch('/api/proxy/timetable/periods');
    if (res.ok) setPeriods(await res.json());
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  function reset() {
    setEditingId(null);
    setAdding(false);
    setConfirmingId(null);
    setError(null);
  }

  function close() {
    setOpen(false);
    reset();
    if (dirty) {
      setDirty(false);
      onChanged?.();
    }
  }

  /**
   * Keep the day in time order after a change.
   *
   * A new period is filed at the end of the list by the API, which is right when the school is
   * writing the day out in order and wrong the moment someone adds a period they forgot at 07:30.
   * The stored order is only ever how the rows are drawn, so renumbering it by the clock is safe;
   * a failure here leaves a row in an odd place, never wrong data, so it does not raise an error.
   */
  async function resequence(rows: Period[]) {
    const chronological = [...rows].sort((a, b) => toMinutes(a.startsAt) - toMinutes(b.startsAt));
    await Promise.all(
      chronological.map((p, i) =>
        p.order === i
          ? null
          : fetch(`/api/proxy/timetable/periods/${p.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ order: i }),
            }).catch(() => null),
      ),
    );
  }

  /**
   * POST or PATCH, then reload — the list is always what the API holds, never what was typed.
   *
   * One action state is enough: only one period is ever being added or changed at a time, so the
   * two places that render the form can never both be showing a button mid-flight.
   */
  const submit = useAsyncAction(async (d: Draft, id?: string) => {
    setError(null);
    const body = JSON.stringify({
      name: d.name.trim(),
      startsMin: toMinutes(d.startsAt),
      endsMin: toMinutes(d.endsAt),
      isBreak: d.isBreak,
    });
    const res = await fetch(
      id ? `/api/proxy/timetable/periods/${id}` : '/api/proxy/timetable/periods',
      { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body },
    );
    if (!res.ok) {
      setError(errorText(await res.json().catch(() => ({})), 'Could not save that period.'));
      throw new Error('rejected');
    }
    const fresh = await fetch('/api/proxy/timetable/periods');
    if (fresh.ok) await resequence(await fresh.json());
    await load();
    setDirty(true);
    reset();
    setNewDraft(BLANK);
  });

  const remove = useAsyncAction(async (p: Period) => {
    setError(null);
    const res = await fetch(`/api/proxy/timetable/periods/${p.id}`, { method: 'DELETE' });
    if (!res.ok) {
      // The API counts the lessons standing in the way and says so. That count is the whole
      // answer to "what would I lose", so it is shown exactly as it arrives.
      setError(errorText(await res.json().catch(() => ({})), 'Could not remove that period.'));
      setConfirmingId(null);
      throw new Error('rejected');
    }
    setDirty(true);
    setConfirmingId(null);
    await load();
  });

  function startEdit(p: Period) {
    setEditingId(p.id);
    setAdding(false);
    setConfirmingId(null);
    setError(null);
    setDraft({ name: p.name, startsAt: p.startsAt, endsAt: p.endsAt, isBreak: p.isBreak });
  }

  const trigger = (
    <Button
      type="button"
      variant={variant === 'primary' ? 'primary' : 'ghost'}
      size={variant === 'primary' ? 'md' : 'sm'}
      onClick={() => setOpen(true)}
    >
      {label}
    </Button>
  );

  if (!open || !mounted) return trigger;

  const rows = periods ?? [];

  /** One set of inputs, used both for adding a period and for changing one. */
  const form = (d: Draft, set: (next: Draft) => void, id: string | undefined) => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit.run(d, id);
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <label className="text-[13px]">
        <span className="block text-oat mb-1">Name</span>
        <input
          required
          value={d.name}
          onChange={(e) => set({ ...d, name: e.target.value })}
          placeholder="Period 1"
          className={`${field} w-40`}
        />
      </label>
      <label className="text-[13px]">
        <span className="block text-oat mb-1">Starts</span>
        <input
          type="time"
          required
          value={d.startsAt}
          onChange={(e) => set({ ...d, startsAt: e.target.value })}
          className={`${field} w-32 tabular`}
        />
      </label>
      <label className="text-[13px]">
        <span className="block text-oat mb-1">Ends</span>
        <input
          type="time"
          required
          value={d.endsAt}
          onChange={(e) => set({ ...d, endsAt: e.target.value })}
          className={`${field} w-32 tabular`}
        />
      </label>
      <label className="flex items-center gap-2 text-[13px] min-h-11">
        <input
          type="checkbox"
          checked={d.isBreak}
          onChange={(e) => set({ ...d, isBreak: e.target.checked })}
          className="h-4 w-4 accent-brand"
        />
        <span>Break — no lessons</span>
      </label>
      <Button type="submit" state={submit.state} icon={id ? <SaveIcon /> : <PlusIcon />}>
        {id ? 'Save' : 'Add period'}
      </Button>
      <Button type="button" variant="ghost" onClick={reset}>
        Cancel
      </Button>
    </form>
  );

  return (
    <>
      {trigger}
      {createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="The school day"
          className="brand-scope fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
          onClick={(e) => e.target === e.currentTarget && close()}
        >
          <div className="card w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="font-display text-2xl">The school day</h2>
            <p className="text-sm text-oat mt-1.5">
              These are the rows every class&apos;s timetable is drawn on — the periods your day is
              divided into, in order. Mark assembly, break and lunch as breaks: they run across the
              whole week and no lesson can be put in them.
            </p>

            <div className="mt-5 divide-y divide-mist/60 border-y border-mist">
              {rows.map((p) => (
                <div key={p.id} className="py-3">
                  {editingId === p.id ? (
                    form(draft, setDraft, p.id)
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-[10rem]">
                        <p className="text-sm font-medium">
                          {p.name}
                          {p.isBreak && (
                            <span className="ml-2 rounded-md bg-parchment px-1.5 py-0.5 text-[11px] font-normal text-oat align-middle">
                              Break
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-oat tabular">
                          {p.startsAt}–{p.endsAt}
                        </p>
                      </div>
                      {confirmingId === p.id ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <p className="text-[12.5px] text-oat max-w-xs">
                            Remove {p.name}? The row disappears from every class&apos;s week. If any
                            lessons are timetabled in it, they must be cleared first — nothing is
                            deleted behind your back.
                          </p>
                          <Button
                            type="button"
                            onClick={() => remove.run(p)}
                            state={remove.state}
                            variant="danger"
                            icon={<TrashIcon />}
                          >
                            Remove
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setConfirmingId(null)}
                          >
                            Keep it
                          </Button>
                        </div>
                      ) : (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            icon={<EditIcon />}
                            onClick={() => startEdit(p)}
                          >
                            Change
                          </Button>
                          {/* Only opens the confirmation beside the row — the danger treatment
                              belongs to the button that actually removes. */}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            icon={<TrashIcon />}
                            onClick={() => {
                              setConfirmingId(p.id);
                              setEditingId(null);
                              setError(null);
                            }}
                          >
                            Remove
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {rows.length === 0 && (
                <p className="py-8 text-sm text-oat text-center">
                  The day has no periods yet. Add the first one below.
                </p>
              )}
            </div>

            <div className="mt-5">
              {adding ? (
                form(newDraft, setNewDraft, undefined)
              ) : (
                <Button
                  type="button"
                  icon={<PlusIcon />}
                  onClick={() => {
                    setAdding(true);
                    setEditingId(null);
                    setConfirmingId(null);
                    setError(null);
                    // Start the next period where the last one finished, which is how a day is
                    // written out, and saves retyping the time that was just entered.
                    const last = [...rows].sort(
                      (a, b) => toMinutes(a.endsAt) - toMinutes(b.endsAt),
                    )[rows.length - 1];
                    setNewDraft(
                      last
                        ? {
                            name: '',
                            startsAt: last.endsAt,
                            endsAt: toTime(Math.min(toMinutes(last.endsAt) + 40, 24 * 60 - 1)),
                            isBreak: false,
                          }
                        : BLANK,
                    );
                  }}
                >
                  Add a period
                </Button>
              )}
            </div>

            {error && (
              <p
                role="alert"
                className="mt-4 text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2"
              >
                {error}
              </p>
            )}

            <div className="mt-5 space-y-2 text-xs text-oat">
              <p className="rounded-lg bg-parchment/60 px-3.5 py-3">
                <strong className="text-ink">Teaching times cannot overlap.</strong> Two periods
                that only touch — 08:00 to 08:40, then 08:40 to 09:20 — are fine. A period that
                covers time already given to a teaching period is refused, and the one in the way is
                named.
              </p>
              <p className="rounded-lg bg-parchment/60 px-3.5 py-3">
                <strong className="text-ink">Lessons come first.</strong> A period that already has
                lessons in it cannot be removed, and cannot be turned into a break, until those
                lessons are cleared from the timetable. Removing a period never quietly wipes work
                that has been done.
              </p>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <Button type="button" variant="secondary" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
