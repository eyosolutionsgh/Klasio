'use client';

import { useCallback, useEffect, useState } from 'react';
import Combobox from '@/components/Combobox';

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
  collector: { kind: string; id: string; name: string; phone: string };
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

const time = (d: string) =>
  new Date(d).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' });

export default function PickupPage() {
  const [students, setStudents] = useState<{ id: string; name: string; className: string }[]>([]);
  const [studentId, setStudentId] = useState('');
  const [auth, setAuth] = useState<Authorised | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [log, setLog] = useState<ReleaseRow[]>([]);

  useEffect(() => {
    fetch('/api/proxy/students?status=ACTIVE')
      .then((r) => r.json())
      .then((d) => setStudents(Array.isArray(d) ? d : (d.students ?? [])));
  }, []);

  const loadLog = useCallback(async () => {
    const res = await fetch('/api/proxy/pickup/log');
    if (res.ok) setLog(await res.json());
  }, []);

  useEffect(() => {
    loadLog();
  }, [loadLog]);

  useEffect(() => {
    setCheck(null);
    setDone(null);
    setError(null);
    setReason('');
    if (!studentId) {
      setAuth(null);
      return;
    }
    fetch(`/api/proxy/pickup/authorised/${studentId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setAuth);
  }, [studentId]);

  async function verify(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/proxy/pickup/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, ...body }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) setCheck(d);
    else setError(d.message ?? 'Could not identify that person.');
  }

  async function release() {
    if (!check) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/proxy/pickup/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId,
        collectorId: check.collector.id,
        collectorKind: check.collector.kind,
        overrideReason: reason || undefined,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setDone(`${d.student} released to ${d.collectedBy}.`);
      setCheck(null);
      setStudentId('');
      loadLog();
    } else {
      setError(d.message ?? 'Could not release.');
    }
  }

  const people = [...(auth?.guardians ?? []), ...(auth?.delegates ?? [])];

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Dismissal</h1>
        <p className="text-sm text-oat mt-1.5">
          Check who is collecting before releasing a child. Every release is logged.
        </p>
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

          {auth && !check && (
            <div className="mt-5">
              <p className="text-[11px] uppercase tracking-wider text-oat">Who is collecting?</p>
              <ul className="mt-2 space-y-2">
                {people.map((p) => (
                  <li key={`${p.kind}-${p.id}`}>
                    <button
                      onClick={() => verify({ collectorId: p.id, collectorKind: p.kind })}
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
                          {p.hasCard ? ' · card' : ''}
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
              <p className="text-sm mt-3">
                Collected by <span className="font-medium">{check.collector.name}</span>
              </p>
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
                <button
                  onClick={release}
                  disabled={busy || !check.verdict.allowed || !!check.alreadyReleasedToday}
                  className="min-h-11 rounded-lg bg-brand text-paper text-sm font-medium px-5 hover:bg-brand-deep transition disabled:opacity-50"
                >
                  {busy ? 'Releasing…' : 'Release child'}
                </button>
                <button
                  onClick={() => setCheck(null)}
                  className="min-h-11 px-3 text-[13px] text-oat hover:text-brand transition"
                >
                  Back
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-danger mt-3">{error}</p>}
          {done && (
            <p className="text-sm text-leaf bg-leaf/10 border border-leaf/20 rounded-lg px-3 py-2 mt-3">
              {done}
            </p>
          )}
        </section>

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
  );
}
