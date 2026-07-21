'use client';

import { useCallback, useEffect, useState } from 'react';
import Combobox from '@/components/Combobox';
import QrScanner from '@/components/QrScanner';
import OfflineBar from '@/components/OfflineBar';
import { submitOrQueue } from '@/lib/offline';
import { Button, useAsyncAction } from '@/components/Button';
import { PlusIcon } from '@/components/icons';

interface Stop {
  id: string;
  name: string;
}
interface Route {
  id: string;
  name: string;
  description: string | null;
  feeItemId: string | null;
  stops: Stop[];
  riders: number;
}
interface ManifestRider {
  studentId: string;
  name: string;
  admissionNo: string;
  className: string | null;
  stop: string | null;
  guardianPhone: string | null;
  today: { direction: string; at: string } | null;
}
interface FeeItem {
  id: string;
  name: string;
  optional: boolean;
}

const time = (d: string) =>
  new Date(d).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' });

/**
 * The bus, run from a phone: routes and stops on the left, the manifest and boarding scans on
 * the right. Scans queue offline with a clientRef — the bus is the definition of offline — and
 * a child off the manifest is still recorded, with the mismatch said out loud.
 */
export default function TransportPage() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routeId, setRouteId] = useState('');
  const [manifest, setManifest] = useState<ManifestRider[]>([]);
  const [students, setStudents] = useState<{ id: string; name: string; className: string }[]>([]);
  const [feeItems, setFeeItems] = useState<FeeItem[]>([]);
  const [direction, setDirection] = useState<'BOARD' | 'ALIGHT'>('BOARD');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [me, setMe] = useState<{ permissions?: string[]; user?: { role: string } } | null>(null);

  const loadRoutes = useCallback(async () => {
    const res = await fetch('/api/proxy/transport/routes');
    if (res.ok) {
      const rows: Route[] = await res.json();
      setRoutes(rows);
      if (rows.length > 0 && !routeId) setRouteId(rows[0].id);
    }
  }, [routeId]);

  const loadManifest = useCallback(async () => {
    if (!routeId) {
      setManifest([]);
      return;
    }
    const res = await fetch(`/api/proxy/transport/routes/${routeId}/manifest`);
    if (res.ok) setManifest((await res.json()).riders);
  }, [routeId]);

  useEffect(() => {
    loadRoutes();
    fetch('/api/proxy/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe);
    fetch('/api/proxy/students?status=ACTIVE&perPage=all')
      .then((r) => r.json())
      .then((d) => setStudents(Array.isArray(d) ? d : (d.rows ?? [])));
    fetch('/api/proxy/fees/items')
      .then((r) => (r.ok ? r.json() : []))
      .then((items: FeeItem[]) =>
        setFeeItems(Array.isArray(items) ? items.filter((i) => i.optional) : []),
      );
  }, [loadRoutes]);

  useEffect(() => {
    loadManifest();
  }, [loadManifest]);

  const canManage =
    me?.user?.role === 'OWNER' || (me?.permissions ?? []).includes('transport.manage');

  const addRoute = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    const f = new FormData(form);
    setError(null);
    const res = await fetch('/api/proxy/transport/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: String(f.get('name') ?? ''),
        feeItemId: String(f.get('feeItemId') ?? '') || undefined,
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? 'Could not add that route.');
      throw new Error('rejected');
    }
    form.reset();
    loadRoutes();
  });

  const addStop = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    const f = new FormData(form);
    const res = await fetch(`/api/proxy/transport/routes/${routeId}/stops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: String(f.get('stop') ?? '') }),
    });
    if (!res.ok) throw new Error('rejected');
    form.reset();
    loadRoutes();
  });

  const [riderId, setRiderId] = useState('');
  const [riderStop, setRiderStop] = useState('');
  const addRider = useAsyncAction(async () => {
    if (!riderId) return;
    setError(null);
    const res = await fetch(`/api/proxy/transport/routes/${routeId}/riders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: riderId, stopId: riderStop || undefined }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? 'Could not add that child.');
      throw new Error('rejected');
    }
    setRiderId('');
    setRiderStop('');
    loadRoutes();
    loadManifest();
  });

  async function removeRider(r: ManifestRider) {
    if (!confirm(`Take ${r.name} off this route? Their transport billing stops too.`)) return;
    const res = await fetch(`/api/proxy/transport/riders/${r.studentId}`, { method: 'DELETE' });
    if (res.ok) {
      loadRoutes();
      loadManifest();
    }
  }

  async function recordScan(payload: { studentId?: string; admissionNo?: string }) {
    setError(null);
    setNotice(null);
    const clientRef = crypto.randomUUID();
    const who =
      (payload.studentId && students.find((s) => s.id === payload.studentId)?.name) ??
      payload.admissionNo ??
      'Child';
    const result = await submitOrQueue(
      '/api/proxy/transport/scan',
      { ...payload, routeId, direction, clientRef },
      `${who} ${direction === 'BOARD' ? 'boarded' : 'alighted'}`,
    );
    if (result.queued) {
      setNotice(`${who} recorded. The network is down — this syncs when it returns.`);
      return;
    }
    const d = (result.body ?? {}) as { student?: string; onManifest?: boolean; message?: string };
    if (result.ok) {
      setNotice(
        `${d.student} ${direction === 'BOARD' ? 'boarded' : 'alighted'}.` +
          (d.onManifest === false ? ' Not on this route’s manifest — check with the office.' : ''),
      );
      loadManifest();
    } else {
      setError(result.message ?? d.message ?? 'Could not record that scan.');
    }
  }

  const route = routes.find((r) => r.id === routeId);

  return (
    <div>
      <OfflineBar />
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Transport</h1>
        <p className="text-sm text-oat mt-1.5">
          Who should be on which bus, and who actually was. Scans work with no signal.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3 rise rise-2">
        <Combobox
          label="Route"
          className="w-56"
          allowClear={false}
          placeholder="Pick a route…"
          options={routes.map((r) => ({
            value: r.id,
            label: r.name,
            hint: `${r.riders} rider${r.riders === 1 ? '' : 's'}`,
          }))}
          value={routeId}
          onChange={setRouteId}
        />
        {canManage && (
          <form onSubmit={addRoute.run} className="flex flex-wrap items-end gap-2">
            <input
              name="name"
              required
              minLength={2}
              placeholder="New route, e.g. Adenta line"
              className="min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand w-52"
            />
            <select
              name="feeItemId"
              className="min-h-11 rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand"
            >
              <option value="">No billing item</option>
              {feeItems.map((i) => (
                <option key={i.id} value={i.id}>
                  Bill via {i.name}
                </option>
              ))}
            </select>
            <Button type="submit" state={addRoute.state} icon={<PlusIcon />} variant="secondary">
              Add route
            </Button>
          </form>
        )}
      </div>

      {route && (
        <div className="grid lg:grid-cols-[1.1fr_1fr] gap-6 mt-6">
          <section className="card p-6 rise rise-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-xl">Manifest — {route.name}</h2>
              <span className="text-[12px] text-oat tabular">{manifest.length} riders</span>
            </div>

            {canManage && (
              <>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <Combobox
                    label="Add child"
                    className="w-52"
                    placeholder="Search students…"
                    options={students.map((s) => ({
                      value: s.id,
                      label: s.name,
                      hint: s.className,
                    }))}
                    value={riderId}
                    onChange={setRiderId}
                  />
                  <Combobox
                    label="Stop"
                    className="w-40"
                    clearLabel="No stop"
                    placeholder="Stop…"
                    options={route.stops.map((s) => ({ value: s.id, label: s.name }))}
                    value={riderStop}
                    onChange={setRiderStop}
                  />
                  <Button
                    onClick={addRider.run}
                    state={addRider.state}
                    disabled={!riderId}
                    icon={<PlusIcon />}
                    variant="secondary"
                  >
                    Add
                  </Button>
                </div>
                <form onSubmit={addStop.run} className="mt-2 flex gap-2">
                  <input
                    name="stop"
                    required
                    placeholder="Add a stop, e.g. Shell signboard"
                    className="flex-1 min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand"
                  />
                  <Button type="submit" state={addStop.state} variant="ghost" size="sm">
                    Add stop
                  </Button>
                </form>
              </>
            )}

            <ul className="mt-4 space-y-2">
              {manifest.map((r) => (
                <li
                  key={r.studentId}
                  className="flex items-center justify-between gap-3 border-b border-mist/50 last:border-0 pb-2 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.name}</p>
                    <p className="text-[11px] text-oat">
                      {r.className ?? '—'}
                      {r.stop && ` · ${r.stop}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {r.today ? (
                      <span
                        className={`text-[11px] font-medium tabular ${
                          r.today.direction === 'BOARD' ? 'text-leaf' : 'text-oat'
                        }`}
                      >
                        {r.today.direction === 'BOARD' ? 'aboard' : 'alighted'} {time(r.today.at)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-oat/60">no scan today</span>
                    )}
                    {canManage && (
                      <button
                        onClick={() => removeRider(r)}
                        className="text-[12px] text-clay hover:underline underline-offset-2"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
              {manifest.length === 0 && (
                <li className="text-sm text-oat">Nobody rides this route yet.</li>
              )}
            </ul>
          </section>

          <section className="card p-6 rise rise-3">
            <h2 className="font-display text-xl">Scan on / off</h2>
            <div className="mt-3 inline-flex rounded-lg border border-mist overflow-hidden">
              {(['BOARD', 'ALIGHT'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDirection(d)}
                  aria-pressed={direction === d}
                  className={`px-4 py-2 text-[13px] font-medium transition ${
                    direction === d ? 'bg-brand text-white' : 'bg-white text-oat hover:text-ink'
                  }`}
                >
                  {d === 'BOARD' ? 'Boarding' : 'Alighting'}
                </button>
              ))}
            </div>
            <p className="text-xs text-oat mt-2">
              Scan the QR on the child&apos;s ID card, or pick them from the list.
            </p>
            <QrScanner onScan={(value) => recordScan({ admissionNo: value })} />
            <div className="mt-3">
              <Combobox
                label="Or pick the child"
                className="w-full"
                placeholder="Search students…"
                options={manifest.map((r) => ({
                  value: r.studentId,
                  label: r.name,
                  hint: r.stop ?? undefined,
                }))}
                value=""
                onChange={(v) => v && recordScan({ studentId: v })}
              />
            </div>
            {notice && (
              <p className="text-sm text-leaf bg-leaf/10 border border-leaf/20 rounded-lg px-3 py-2 mt-3">
                {notice}
              </p>
            )}
            {error && <p className="text-sm text-danger mt-3">{error}</p>}
          </section>
        </div>
      )}
      {routes.length === 0 && (
        <p className="card p-6 mt-6 text-sm text-oat rise rise-3">
          No routes yet.{' '}
          {canManage
            ? 'Add the first route above — stops and riders follow.'
            : 'Ask whoever manages transport to set up the routes.'}
        </p>
      )}
    </div>
  );
}
