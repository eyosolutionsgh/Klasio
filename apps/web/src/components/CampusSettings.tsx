'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, useAsyncAction } from './Button';
import { PlusIcon } from './icons';

interface Campus {
  id: string;
  name: string;
  address: string | null;
  classCount: number;
}
interface ClassRow {
  id: string;
  name: string;
  campusId: string | null;
}

const field =
  'min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

/**
 * Several campuses under one school (FEATURES.md §1). Hidden entirely when the package has no
 * multi-campus — the school's single site needs no name. Classes are assigned here; students
 * derive their campus through their class.
 */
export default function CampusSettings() {
  const [entitled, setEntitled] = useState(false);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [me, c, s] = await Promise.all([
      fetch('/api/proxy/me').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/proxy/school/campuses').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/proxy/school/structure').then((r) => (r.ok ? r.json() : null)),
    ]);
    setEntitled(!!me?.entitlements?.includes('platform.multicampus'));
    setCampuses(c);
    setClasses(
      (s?.classes ?? []).map((x: { id: string; name: string; campusId: string | null }) => ({
        id: x.id,
        name: x.name,
        campusId: x.campusId,
      })),
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    const f = new FormData(form);
    setError(null);
    const res = await fetch('/api/proxy/school/campuses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: String(f.get('name') ?? ''),
        address: String(f.get('address') ?? '') || undefined,
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? 'Could not add that campus.');
      throw new Error('rejected');
    }
    form.reset();
    load();
  });

  async function remove(c: Campus) {
    if (
      !confirm(
        `Remove ${c.name}? Its ${c.classCount} class${c.classCount === 1 ? '' : 'es'} fall back to the main site — nothing else changes.`,
      )
    )
      return;
    const res = await fetch(`/api/proxy/school/campuses/${c.id}`, { method: 'DELETE' });
    if (res.ok) load();
  }

  async function assign(cls: ClassRow, campusId: string) {
    setBusy(cls.id);
    await fetch(`/api/proxy/school/classes/${cls.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campusId }),
    });
    setBusy(null);
    load();
  }

  if (!entitled) return null;

  return (
    <section className="card p-6 rise rise-4">
      <h2 className="font-display text-xl">Campuses</h2>
      <p className="text-sm text-oat mt-1.5">
        Several sites, one school — one licence, one set of records. A class without a campus
        belongs to the main site.
      </p>

      <ul className="mt-4 space-y-2">
        {campuses.map((c) => (
          <li
            key={c.id}
            className="flex items-center justify-between gap-3 border-b border-mist/50 last:border-0 pb-2 last:pb-0"
          >
            <div>
              <p className="text-sm font-medium">{c.name}</p>
              <p className="text-[11px] text-oat">
                {c.address ? `${c.address} · ` : ''}
                {c.classCount} class{c.classCount === 1 ? '' : 'es'}
              </p>
            </div>
            <button
              onClick={() => remove(c)}
              className="text-[12px] text-clay hover:underline underline-offset-2"
            >
              Remove
            </button>
          </li>
        ))}
        {campuses.length === 0 && (
          <li className="text-sm text-oat">No campuses yet — everything is the main site.</li>
        )}
      </ul>

      <form onSubmit={add.run} className="mt-4 flex flex-wrap gap-2">
        <input
          name="name"
          required
          minLength={2}
          placeholder="East Legon Campus"
          className={`${field} w-52`}
        />
        <input
          name="address"
          placeholder="Address (optional)"
          className={`${field} flex-1 min-w-[10rem]`}
        />
        <Button type="submit" state={add.state} icon={<PlusIcon />}>
          Add campus
        </Button>
      </form>
      {error && <p className="text-sm text-danger mt-2">{error}</p>}

      {campuses.length > 0 && (
        <div className="mt-6">
          <p className="text-[11px] uppercase tracking-wider text-oat">Which class sits where</p>
          <ul className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {classes.map((cls) => (
              <li key={cls.id} className="flex items-center justify-between gap-3 text-sm">
                <span>{cls.name}</span>
                <select
                  value={cls.campusId ?? ''}
                  disabled={busy === cls.id}
                  onChange={(e) => assign(cls, e.target.value)}
                  className="min-h-9 rounded-lg border border-mist bg-white px-2 py-1 text-[13px] outline-none focus:border-brand"
                >
                  <option value="">Main site</option>
                  {campuses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
