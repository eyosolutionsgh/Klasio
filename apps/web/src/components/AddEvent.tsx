'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const field =
  'w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

/**
 * Put something on the calendar. Audience is the consequential field — it decides whether a
 * parent ever sees this — so it sits above the fold with its meaning spelled out.
 */
export default function AddEvent({
  levels,
  audiences,
}: {
  levels: { id: string; name: string }[];
  audiences: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [location, setLocation] = useState('');
  const [audience, setAudience] = useState('ALL');
  const [levelId, setLevelId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/proxy/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        details: details || undefined,
        // A bare date is what the school means by an all-day event.
        startsAt: new Date(startsAt).toISOString(),
        endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
        location: location || undefined,
        audience,
        levelId: levelId || undefined,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setTitle('');
      setDetails('');
      setStartsAt('');
      setEndsAt('');
      setLocation('');
      setLevelId('');
      router.refresh();
    } else {
      const b = await res.json().catch(() => ({}));
      setError(b.message ?? 'Could not save the event.');
    }
  }

  return (
    <form onSubmit={submit} className="card p-6 h-fit rise rise-2">
      <h2 className="font-display text-xl">Add an event</h2>

      <label className="block text-sm font-medium mt-5 mb-1.5" htmlFor="ev-title">
        Title
      </label>
      <input
        id="ev-title"
        required
        minLength={3}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. Mid-term examinations begin"
        className={field}
      />

      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="ev-start">
            Starts
          </label>
          <input
            id="ev-start"
            type="date"
            required
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className={field}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="ev-end">
            Ends <span className="text-oat font-normal">(optional)</span>
          </label>
          <input
            id="ev-end"
            type="date"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className={field}
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="ev-audience">
            Who sees it
          </label>
          <select
            id="ev-audience"
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
          <label className="block text-sm font-medium mb-1.5" htmlFor="ev-level">
            Level
          </label>
          <select
            id="ev-level"
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

      <label className="block text-sm font-medium mt-4 mb-1.5" htmlFor="ev-location">
        Location <span className="text-oat font-normal">(optional)</span>
      </label>
      <input
        id="ev-location"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="e.g. Assembly hall"
        className={field}
      />

      <label className="block text-sm font-medium mt-4 mb-1.5" htmlFor="ev-details">
        Details <span className="text-oat font-normal">(optional)</span>
      </label>
      <textarea
        id="ev-details"
        rows={3}
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        placeholder="Anything families need to know…"
        className={`${field} resize-y`}
      />

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="mt-5 rounded-lg bg-brand text-paper text-sm font-medium px-5 py-2.5 hover:bg-brand-deep transition disabled:opacity-60"
      >
        {busy ? 'Saving…' : 'Add to calendar'}
      </button>
    </form>
  );
}
