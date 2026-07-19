'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

export interface EventSummary {
  id: string;
  title: string;
  details: string | null;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  audience: string;
  levelId: string | null;
}

const field =
  'w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

/** An ISO instant → the "YYYY-MM-DD" an `<input type="date">` insists on. */
const dateValue = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

/**
 * Change or remove a calendar entry.
 *
 * A wrong date is the sort of mistake a school notices only after families have read it, and the
 * only remedy used to be deleting the entry and writing it again — so the correction arrived as a
 * new event standing beside the memory of the wrong one. Amending it in place reads as a
 * correction, which is what it is.
 */
export default function EventActions({
  event,
  levels,
  audiences,
}: {
  event: EventSummary;
  levels: { id: string; name: string }[];
  audiences: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(event.title);
  const [details, setDetails] = useState(event.details ?? '');
  const [startsAt, setStartsAt] = useState(dateValue(event.startsAt));
  const [endsAt, setEndsAt] = useState(dateValue(event.endsAt));
  const [location, setLocation] = useState(event.location ?? '');
  const [audience, setAudience] = useState(event.audience);
  const [levelId, setLevelId] = useState(event.levelId ?? '');

  useEffect(() => setMounted(true), []);

  function start() {
    setTitle(event.title);
    setDetails(event.details ?? '');
    setStartsAt(dateValue(event.startsAt));
    setEndsAt(dateValue(event.endsAt));
    setLocation(event.location ?? '');
    setAudience(event.audience);
    setLevelId(event.levelId ?? '');
    setError(null);
    setOpen(true);
  }

  /** Removing an event is one click, so it asks first — families may already have been told. */
  async function remove() {
    if (!confirm(`Remove “${event.title}” from the calendar?`)) return;
    setBusy(true);
    const res = await fetch(`/api/proxy/calendar/${event.id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/proxy/calendar/${event.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        details,
        startsAt: new Date(startsAt).toISOString(),
        // An end date typed by mistake can be taken back off. Null rather than "": the DTO's
        // @IsOptional() waves null past @IsDateString(), and the service reads it as "no end".
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        location,
        audience,
        // Empty is how the form says "the whole school again".
        levelId,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(
        Array.isArray(b.message)
          ? b.message.join('. ')
          : (b.message ?? 'Could not save the event.'),
      );
      return;
    }
    setOpen(false);
    router.refresh();
  }

  const controls = (
    <span className="no-print flex items-center gap-3 shrink-0">
      <button
        type="button"
        onClick={start}
        className="text-[12px] font-medium text-brand hover:underline underline-offset-2 whitespace-nowrap"
      >
        Change
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="text-[12px] text-clay hover:underline disabled:opacity-50 whitespace-nowrap"
      >
        {busy ? 'Removing…' : 'Remove'}
      </button>
    </span>
  );

  if (!open || !mounted) return controls;

  return (
    <>
      {controls}
      {createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Change ${event.title}`}
          className="brand-scope fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <form onSubmit={save} className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="font-display text-2xl">Change this event</h2>
            <p className="text-sm text-oat mt-1.5">
              The entry is amended in place, so anyone who has already seen it gets the correction
              rather than a second event beside the wrong one.
            </p>

            <label className="block text-sm font-medium mt-5 mb-1.5" htmlFor="ed-title">
              Title
            </label>
            <input
              id="ed-title"
              required
              minLength={3}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={field}
            />

            <div className="grid sm:grid-cols-2 gap-3 mt-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" htmlFor="ed-start">
                  Starts
                </label>
                <input
                  id="ed-start"
                  type="date"
                  required
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  className={field}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5" htmlFor="ed-end">
                  Ends <span className="text-oat font-normal">(optional)</span>
                </label>
                <input
                  id="ed-end"
                  type="date"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  className={field}
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 mt-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" htmlFor="ed-audience">
                  Who sees it
                </label>
                <select
                  id="ed-audience"
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  className={field}
                >
                  {audiences.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5" htmlFor="ed-level">
                  Level
                </label>
                <select
                  id="ed-level"
                  value={levelId}
                  onChange={(e) => setLevelId(e.target.value)}
                  className={field}
                >
                  <option value="">Whole school</option>
                  {levels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="block text-sm font-medium mt-4 mb-1.5" htmlFor="ed-location">
              Location <span className="text-oat font-normal">(optional)</span>
            </label>
            <input
              id="ed-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Assembly hall"
              className={field}
            />

            <label className="block text-sm font-medium mt-4 mb-1.5" htmlFor="ed-details">
              Details <span className="text-oat font-normal">(optional)</span>
            </label>
            <textarea
              id="ed-details"
              rows={3}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              className={`${field} resize-y`}
            />

            {error && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            )}

            <div className="flex items-center gap-3 mt-5">
              <button
                type="submit"
                disabled={busy}
                className="min-h-11 rounded-lg bg-brand text-paper text-sm font-medium px-5 hover:bg-brand-deep transition disabled:opacity-60"
              >
                {busy ? 'Saving…' : 'Save event'}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-11 px-3 text-[13px] text-oat hover:text-brand transition"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>,
        document.body,
      )}
    </>
  );
}
