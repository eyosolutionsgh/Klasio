'use client';

import { useCallback, useEffect, useState } from 'react';
import Combobox from '@/components/Combobox';
import DismissalInbox from '@/components/DismissalInbox';
import EmergencyAlert from '@/components/EmergencyAlert';
import CarLineQueue from '@/components/CarLineQueue';
import QrScanner from '@/components/QrScanner';
import { submitOrQueue } from '@/lib/offline';
import OfflineBar from '@/components/OfflineBar';
import { Button, useAsyncAction } from '@/components/Button';
import { KeyIcon, LockIcon } from '@/components/icons';

interface Verdict {
  allowed: boolean;
  requiresOverride?: boolean;
  reasonCode?: string;
}
interface Check {
  student: {
    id: string;
    name: string;
    admissionNo: string;
    className: string | null;
    photoUrl: string | null;
  };
  collector: { kind: string; id: string; name: string; phone: string; hasPhoto: boolean };
  method: string;
  verdict: Verdict;
  message: string;
  alreadyReleasedToday: { collectedBy: string; at: string } | null;
}
interface Authorised {
  guardians: {
    kind: string;
    id: string;
    name: string;
    relationship: string;
    custodyFlag: string;
    canPickup: boolean;
    hasCard: boolean;
    message: string;
    verdict: Verdict;
  }[];
  delegates: {
    kind: string;
    id: string;
    name: string;
    relationship: string;
    hasCard: boolean;
    message: string;
    verdict: Verdict;
  }[];
}
interface ReleaseRow {
  id: string;
  student: string;
  className: string;
  collectedBy: string;
  method: string;
  overrideReason: string | null;
  releasedAt: string;
}
interface CheckInRow {
  id: string;
  student: string;
  className: string;
  broughtBy: string | null;
  method: string;
  checkedInAt: string;
}

const time = (d: string) =>
  new Date(d).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' });

export default function PickupPage() {
  const [students, setStudents] = useState<{ id: string; name: string; className: string }[]>([]);
  const [studentId, setStudentId] = useState('');
  const [auth, setAuth] = useState<Authorised | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [reason, setReason] = useState('');
  const [token, setToken] = useState('');
  const [pin, setPin] = useState('');
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [log, setLog] = useState<ReleaseRow[]>([]);
  // Morning and afternoon share the one gate device, so arrivals live on the same page.
  const [mode, setMode] = useState<'ARRIVAL' | 'DISMISSAL'>('DISMISSAL');
  const [broughtBy, setBroughtBy] = useState('');
  const [arrivals, setArrivals] = useState<CheckInRow[]>([]);

  useEffect(() => {
    // `perPage=all` on purpose: this is the dismissal desk's picker, not a browsable list, and a
    // child who fell on page 2 could not be released at all.
    fetch('/api/proxy/students?status=ACTIVE&perPage=all')
      .then((r) => r.json())
      .then((d) => setStudents(Array.isArray(d) ? d : (d.rows ?? [])));
  }, []);

  const loadLog = useCallback(async () => {
    const res = await fetch('/api/proxy/pickup/log');
    if (res.ok) setLog(await res.json());
  }, []);

  const loadArrivals = useCallback(async () => {
    const res = await fetch('/api/proxy/pickup/checkins');
    if (res.ok) setArrivals(await res.json());
  }, []);

  useEffect(() => {
    loadLog();
    loadArrivals();
  }, [loadLog, loadArrivals]);

  useEffect(() => {
    setCheck(null);
    setDone(null);
    setError(null);
    setReason('');
    setToken('');
    setPin('');
    setPinFor(null);
    if (!studentId) {
      setAuth(null);
      return;
    }
    fetch(`/api/proxy/pickup/authorised/${studentId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setAuth);
  }, [studentId]);

  async function verify(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch('/api/proxy/pickup/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, ...body }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.message ?? 'Could not identify that person.');
      throw new Error('rejected');
    }
    setCheck(d);
  }

  /** The three ways to name the collector: a scanned/typed pass, their PIN, or picking them. */
  const checkPass = useAsyncAction((value: string) => verify({ token: value }));
  const checkPin = useAsyncAction((p: { id: string; kind: string }) =>
    verify({ pin, collectorId: p.id, collectorKind: p.kind }),
  );
  const pick = useAsyncAction((p: { id: string; kind: string }) =>
    verify({ collectorId: p.id, collectorKind: p.kind }),
  );
  // The gate makes one decision at a time: a check in flight still locks the other routes to it.
  const busy =
    checkPass.state === 'pending' || checkPin.state === 'pending' || pick.state === 'pending';

  const releaseAction = useAsyncAction(async () => {
    if (!check) return;
    setError(null);
    // The gate mints the key, not the server: it has to survive the request failing and being
    // replayed later, which is the whole point of it.
    const clientRef = crypto.randomUUID();
    const result = await submitOrQueue(
      '/api/proxy/pickup/release',
      {
        studentId,
        collectorId: check.collector.id,
        collectorKind: check.collector.kind,
        overrideReason: reason || undefined,
        clientRef,
      },
      `${check.student.name} collected by ${check.collector.name}`,
    );

    if (result.queued) {
      // Released on the ground; the record catches up. Saying so plainly matters — staff must
      // not stand at the gate wondering whether to let the child go.
      setDone(
        `${check.student.name} released. The network is down, so this will be recorded as soon ` +
          'as it comes back.',
      );
      setCheck(null);
      setStudentId('');
      setToken('');
      setReason('');
      return;
    }

    const d = (result.body ?? {}) as {
      student?: string;
      collectedBy?: string;
      message?: string;
    };
    if (result.ok) {
      setDone(
        `${d.student ?? check.student.name} released to ${d.collectedBy ?? check.collector.name}.`,
      );
      setCheck(null);
      setStudentId('');
      loadLog();
    } else {
      setError(result.message ?? d.message ?? 'Could not release.');
      throw new Error('rejected');
    }
  });

  const checkInAction = useAsyncAction(async () => {
    if (!studentId) return;
    setError(null);
    const student = students.find((s) => s.id === studentId);
    const clientRef = crypto.randomUUID();
    const result = await submitOrQueue(
      '/api/proxy/pickup/checkin',
      {
        studentId,
        broughtBy: broughtBy.trim() || undefined,
        token: token.trim() || undefined,
        clientRef,
      },
      `${student?.name ?? 'Child'} checked in`,
    );

    if (result.queued) {
      setDone(
        `${student?.name ?? 'Child'} checked in. The network is down, so this will be recorded ` +
          'as soon as it comes back.',
      );
      setStudentId('');
      setBroughtBy('');
      setToken('');
      return;
    }

    const d = (result.body ?? {}) as { student?: string; message?: string };
    if (result.ok) {
      setDone(`${d.student ?? student?.name ?? 'Child'} checked in.`);
      setStudentId('');
      setBroughtBy('');
      setToken('');
      loadArrivals();
    } else {
      setError(result.message ?? d.message ?? 'Could not check in.');
      throw new Error('rejected');
    }
  });

  const people = [...(auth?.guardians ?? []), ...(auth?.delegates ?? [])];

  return (
    <div>
      {/* The gate can release with the network down, so it must show what is still unsent. */}
      <OfflineBar />
      <div className="rise rise-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">
            {mode === 'DISMISSAL' ? 'Dismissal' : 'Arrivals'}
          </h1>
          <p className="text-sm text-oat mt-1.5">
            {mode === 'DISMISSAL'
              ? 'Check who is collecting before releasing a child. Every release is logged.'
              : 'Record each child arriving. Who brought them is optional — many walk in alone.'}
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-mist overflow-hidden" role="tablist">
          {(['ARRIVAL', 'DISMISSAL'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setCheck(null);
                setDone(null);
                setError(null);
              }}
              className={`px-4 py-2 text-[13px] font-medium transition ${
                mode === m ? 'bg-brand text-white' : 'bg-white text-oat hover:text-ink'
              }`}
            >
              {m === 'ARRIVAL' ? 'Morning arrivals' : 'Dismissal'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1.1fr_1fr] gap-6 mt-6">
        <section className="card p-6 rise rise-2">
          <Combobox
            label="Child"
            className="w-full"
            allowClear={false}
            placeholder="Search by name…"
            options={students.map((s) => ({ value: s.id, label: s.name, hint: s.className }))}
            value={studentId}
            onChange={setStudentId}
          />

          {mode === 'ARRIVAL' && studentId && (
            <div className="mt-5 rounded-lg bg-parchment/60 p-4">
              <p className="text-[11px] uppercase tracking-wider text-oat">Check in</p>
              <p className="text-xs text-oat mt-1">
                Scan the pass of whoever brought them, or type a name — or neither, if the child
                came alone.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <div className="relative flex-1 min-w-[12rem]">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                    <KeyIcon />
                  </span>
                  <input
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Pass code from the QR (optional)"
                    className="w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 pl-10 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                  />
                </div>
                <input
                  value={broughtBy}
                  onChange={(e) => setBroughtBy(e.target.value)}
                  placeholder="Brought by (optional)"
                  className="flex-1 min-w-[10rem] min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                />
              </div>
              <QrScanner onScan={(value) => setToken(value)} />
              <div className="mt-3">
                <Button
                  onClick={checkInAction.run}
                  state={checkInAction.state}
                  pendingLabel="Checking in…"
                  doneLabel="Checked in!"
                  failedLabel="Couldn't check in"
                >
                  Check in
                </Button>
              </div>
            </div>
          )}

          {mode === 'DISMISSAL' && studentId && !check && (
            <div className="mt-5 rounded-lg bg-parchment/60 p-4">
              <p className="text-[11px] uppercase tracking-wider text-oat">
                Scan or enter a gate pass
              </p>
              <p className="text-xs text-oat mt-1">
                Scanning fills this automatically. If the pass is at home, pick the person below and
                enter their PIN instead.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  // Guard here rather than in the action, so an empty Enter is a no-op instead of
                  // a tick on a check that never ran.
                  if (token.trim()) checkPass.run(token.trim());
                }}
                className="flex flex-wrap gap-2 mt-3"
              >
                {/* A gate pass is a key, not a search box. */}
                <div className="relative flex-1 min-w-[12rem]">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                    <KeyIcon />
                  </span>
                  <input
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Pass code from the QR"
                    autoFocus
                    className="w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 pl-10 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                  />
                </div>
                <Button
                  type="submit"
                  state={checkPass.state}
                  disabled={busy || !token.trim()}
                  pendingLabel="Checking…"
                  doneLabel="Verified!"
                  failedLabel="No match"
                >
                  Check pass
                </Button>
              </form>
              <QrScanner
                onScan={(value) => {
                  setToken(value);
                  checkPass.run(value);
                }}
              />
            </div>
          )}

          {mode === 'DISMISSAL' && auth && !check && (
            <div className="mt-5">
              <p className="text-[11px] uppercase tracking-wider text-oat">Who is collecting?</p>
              <ul className="mt-2 space-y-2">
                {people.map((p) => (
                  <li key={`${p.kind}-${p.id}`}>
                    <button
                      onClick={() =>
                        pinFor === `${p.kind}-${p.id}`
                          ? undefined
                          : pick.run({ id: p.id, kind: p.kind })
                      }
                      disabled={busy || !p.verdict.allowed}
                      className={`w-full text-left rounded-lg border px-4 py-3 transition disabled:opacity-60 ${
                        !p.verdict.allowed
                          ? 'border-danger/40 bg-danger/5'
                          : p.verdict.requiresOverride
                            ? 'border-clay/40 bg-clay/5 hover:border-clay'
                            : 'border-mist hover:border-brand'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-medium text-sm">{p.name}</span>
                        <span className="text-[11px] text-oat shrink-0">
                          {p.relationship}
                          {p.hasCard ? ' · pass' : ''}
                        </span>
                      </span>
                      <span
                        className={`block text-[12px] mt-0.5 ${
                          !p.verdict.allowed
                            ? 'text-danger font-medium'
                            : p.verdict.requiresOverride
                              ? 'text-clay'
                              : 'text-leaf'
                        }`}
                      >
                        {p.message}
                      </span>
                    </button>
                    {p.hasCard && p.verdict.allowed && (
                      <div className="mt-1 pl-1">
                        {pinFor === `${p.kind}-${p.id}` ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              checkPin.run({ id: p.id, kind: p.kind });
                            }}
                            className="flex gap-2"
                          >
                            {/* A PIN is a secret, so the lock rather than the key. Widened to
                                w-40 to leave the digits room once the icon takes the left. */}
                            <div className="relative">
                              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                                <LockIcon />
                              </span>
                              <input
                                value={pin}
                                onChange={(e) => setPin(e.target.value)}
                                inputMode="numeric"
                                autoFocus
                                placeholder="6-digit PIN"
                                className="w-40 min-h-11 rounded-lg border border-mist bg-white px-3 py-2 pl-10 text-sm tabular outline-none focus:border-brand"
                              />
                            </div>
                            <Button
                              type="submit"
                              variant="secondary"
                              state={checkPin.state}
                              disabled={busy || pin.length < 4}
                              pendingLabel="Checking…"
                              doneLabel="Verified!"
                              failedLabel="No match"
                            >
                              Check PIN
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              type="button"
                              onClick={() => setPinFor(null)}
                            >
                              Cancel
                            </Button>
                          </form>
                        ) : (
                          <button
                            onClick={() => {
                              setPinFor(`${p.kind}-${p.id}`);
                              setPin('');
                            }}
                            className="text-[12px] text-oat hover:text-brand underline underline-offset-2"
                          >
                            Verify with their PIN instead
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
                {people.length === 0 && (
                  <li className="text-sm text-oat">
                    Nobody is on this child&apos;s list yet — add a guardian or a delegate first.
                  </li>
                )}
              </ul>
            </div>
          )}

          {check && (
            <div className="mt-5 rounded-lg border border-mist p-4">
              <p className="text-[11px] uppercase tracking-wider text-oat">Confirm</p>
              <p className="font-display text-2xl mt-1">{check.student.name}</p>
              <p className="text-sm text-oat">
                {check.student.admissionNo}
                {check.student.className && ` · ${check.student.className}`}
              </p>
              <div className="flex items-center gap-3 mt-3">
                {/* The pass proves the pass; only the face proves the person holding it. */}
                {check.collector.hasPhoto ? (
                  <img
                    src={`/api/proxy/pickup/${check.collector.kind === 'GUARDIAN' ? 'guardians' : 'delegates'}/${check.collector.id}/photo`}
                    alt={check.collector.name}
                    className="w-16 h-16 rounded-lg object-cover border border-mist shrink-0"
                  />
                ) : (
                  <span className="w-16 h-16 rounded-lg bg-parchment border border-mist grid place-items-center text-[10px] text-oat text-center px-1 shrink-0">
                    No photo
                  </span>
                )}
                <div>
                  <p className="text-sm">
                    Collected by <span className="font-medium">{check.collector.name}</span>
                  </p>
                  {!check.collector.hasPhoto && (
                    <p className="text-[11px] text-oat mt-0.5">
                      Check their face against the pass or ask for ID.
                    </p>
                  )}
                </div>
              </div>
              <p
                className={`text-[13px] mt-2 ${
                  !check.verdict.allowed
                    ? 'text-danger font-medium'
                    : check.verdict.requiresOverride
                      ? 'text-clay'
                      : 'text-leaf'
                }`}
              >
                {check.message}
              </p>

              {check.alreadyReleasedToday && (
                <p className="text-[13px] text-danger mt-2">
                  Already collected today by {check.alreadyReleasedToday.collectedBy} at{' '}
                  {time(check.alreadyReleasedToday.at)}.
                </p>
              )}

              {check.verdict.allowed && check.verdict.requiresOverride && (
                <label className="block text-[13px] mt-3">
                  <span className="block text-oat mb-1">Reason for releasing anyway</span>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Mother phoned, aunt collecting today"
                    className="w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                  />
                  <span className="block text-[11px] text-oat mt-1">
                    Recorded in the release log against your name.
                  </span>
                </label>
              )}

              <div className="flex items-center gap-3 mt-4">
                <Button
                  onClick={releaseAction.run}
                  state={releaseAction.state}
                  disabled={busy || !check.verdict.allowed || !!check.alreadyReleasedToday}
                  pendingLabel="Releasing…"
                  doneLabel="Released!"
                  failedLabel="Couldn't release"
                >
                  Release child
                </Button>
                <Button variant="ghost" size="sm" type="button" onClick={() => setCheck(null)}>
                  Back
                </Button>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-danger mt-3">{error}</p>}
          {/*
            Not the button repeating itself: releasing clears the whole panel, so this note is the
            only record on screen of *which* child went with *whom* — and offline it says the thing
            the tick cannot, that the gate let the child go before the record did.
          */}
          {done && (
            <p className="text-sm text-leaf bg-leaf/10 border border-leaf/20 rounded-lg px-3 py-2 mt-3">
              {done}
            </p>
          )}
        </section>

        <div className="space-y-6">
          <EmergencyAlert />
          {mode === 'ARRIVAL' && (
            <section className="card p-6 rise rise-3">
              <h2 className="font-display text-xl">Arrived today</h2>
              <p className="text-sm text-oat mt-1.5">
                {arrivals.length} child{arrivals.length === 1 ? '' : 'ren'} checked in.
              </p>
              <ul className="mt-4 space-y-3">
                {arrivals.map((r) => (
                  <li key={r.id} className="border-b border-mist/50 last:border-0 pb-3 last:pb-0">
                    <div className="flex justify-between gap-3">
                      <span className="text-sm font-medium">{r.student}</span>
                      <span className="text-[11px] text-oat tabular shrink-0">
                        {time(r.checkedInAt)}
                      </span>
                    </div>
                    <p className="text-[12px] text-oat">
                      {r.className}
                      {r.broughtBy ? ` · brought by ${r.broughtBy}` : ' · came alone'}
                    </p>
                  </li>
                ))}
                {arrivals.length === 0 && (
                  <li className="text-sm text-oat">Nobody has been checked in yet today.</li>
                )}
              </ul>
            </section>
          )}
          {mode === 'DISMISSAL' && <CarLineQueue />}
          {mode === 'DISMISSAL' && <DismissalInbox />}

          <section className="card p-6 rise rise-3">
            <h2 className="font-display text-xl">Released today</h2>
            <p className="text-sm text-oat mt-1.5">
              {log.length} child{log.length === 1 ? '' : 'ren'} collected.
            </p>
            <ul className="mt-4 space-y-3">
              {log.map((r) => (
                <li key={r.id} className="border-b border-mist/50 last:border-0 pb-3 last:pb-0">
                  <div className="flex justify-between gap-3">
                    <span className="text-sm font-medium">{r.student}</span>
                    <span className="text-[11px] text-oat tabular shrink-0">
                      {time(r.releasedAt)}
                    </span>
                  </div>
                  <p className="text-[12px] text-oat">
                    {r.className} · to {r.collectedBy} · {r.method.toLowerCase()}
                  </p>
                  {r.overrideReason && (
                    <p className="text-[12px] text-clay mt-0.5">Override: {r.overrideReason}</p>
                  )}
                </li>
              ))}
              {log.length === 0 && (
                <li className="text-sm text-oat">Nobody has been collected yet today.</li>
              )}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
