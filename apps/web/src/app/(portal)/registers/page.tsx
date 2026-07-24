'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, useAsyncAction } from '@/components/Button';
import { SaveIcon } from '@/components/icons';
import ConfirmButton from '@/components/ConfirmButton';

/**
 * The books a school used to keep on a shelf.
 *
 * One screen with six tabs rather than six screens, because that is how they are used: whoever is
 * on duty writes the log, signs a visitor in, and notes an incident within the same ten minutes at
 * the front desk. Splitting them across the sidebar would make the common afternoon three
 * navigations long.
 *
 * Each tab shows only what the signed-in person may actually use — the tab list is filtered by
 * permission rather than the buttons being disabled, since a front-desk clerk has no use for a
 * lesson-note queue and should not have to wonder why it is greyed out.
 */
const TABS = [
  { id: 'logbook', label: 'Log book', needs: 'registers.logbook' },
  { id: 'duty', label: 'Duty roster', needs: 'registers.logbook' },
  { id: 'notes', label: 'Lesson notes', needs: 'registers.lesson_notes' },
  { id: 'discipline', label: 'Discipline', needs: 'registers.discipline' },
  { id: 'visitors', label: 'Visitors', needs: 'registers.visitors' },
  { id: 'feeding', label: 'Feeding money', needs: 'registers.feeding' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Where each tab's list comes from. Empty means the tab loads itself (feeding needs a class). */
const LIST_PATHS: Record<TabId, string> = {
  logbook: '/registers/logbook',
  duty: '/registers/duty',
  notes: '/registers/lesson-notes',
  discipline: '/registers/discipline',
  visitors: '/registers/visitors',
  feeding: '',
};

const field =
  'rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

const fmt = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';
const fmtTime = (d: string | null) =>
  d
    ? new Date(d).toLocaleString('en-GH', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

interface Row {
  id: string;
  [k: string]: unknown;
}

export default function RegistersPage() {
  const [held, setHeld] = useState<string[]>([]);
  const [tab, setTab] = useState<TabId>('logbook');
  const [rows, setRows] = useState<Row[]>([]);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/proxy/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        const perms: string[] = me?.permissions ?? [];
        setHeld(perms);
        const first = TABS.find((t) => perms.includes(t.needs));
        if (first) setTab(first.id);
      })
      .catch(() => {});
    fetch('/api/proxy/school/structure')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setClasses(s?.classes ?? []))
      .catch(() => {});
    fetch('/api/proxy/users')
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => setStaff((u?.rows ?? u ?? []).map((x: { id: string; name: string }) => x)))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const path = LIST_PATHS[tab];
    // Feeding is loaded per class and date rather than as a flat list, so it has its own loader.
    if (!path) return;
    const res = await fetch(`/api/proxy${path}?perPage=50`);
    if (!res.ok) return;
    const data = await res.json();
    setRows(data.rows ?? []);
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  async function post(path: string, body: unknown, method = 'POST') {
    setError(null);
    const res = await fetch(`/api/proxy${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        Array.isArray(data.message)
          ? data.message.join('. ')
          : (data.message ?? 'That did not work.'),
      );
      throw new Error('rejected');
    }
    load();
    return data;
  }

  // ── per-tab form state ───────────────────────────────────────────
  const [logBody, setLogBody] = useState('');
  const [logKind, setLogKind] = useState('GENERAL');
  const writeLog = useAsyncAction(async () => {
    await post('/registers/logbook', { body: logBody, kind: logKind });
    setLogBody('');
  });

  const [dutyUser, setDutyUser] = useState('');
  const [dutyFrom, setDutyFrom] = useState('');
  const [dutyTo, setDutyTo] = useState('');
  const assignDuty = useAsyncAction(async () => {
    await post('/registers/duty', { userId: dutyUser, startDate: dutyFrom, endDate: dutyTo });
  });

  const [noteTitle, setNoteTitle] = useState('');
  const [noteWeek, setNoteWeek] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const submitNote = useAsyncAction(async () => {
    await post('/registers/lesson-notes', { title: noteTitle, weekOf: noteWeek, body: noteBody });
    setNoteTitle('');
    setNoteBody('');
  });

  const [visitor, setVisitor] = useState({
    name: '',
    organisation: '',
    purpose: '',
    toSee: '',
    phone: '',
  });
  const signIn = useAsyncAction(async () => {
    await post('/registers/visitors', visitor);
    setVisitor({ name: '', organisation: '', purpose: '', toSee: '', phone: '' });
  });

  const [feedClass, setFeedClass] = useState('');
  const [feedDate, setFeedDate] = useState(new Date().toISOString().slice(0, 10));
  const [feedAmount, setFeedAmount] = useState('');
  const [feeding, setFeeding] = useState<{
    collected: number;
    paidCount: number;
    unpaidCount: number;
    rows: { studentId: string; name: string; admissionNo: string; amount: number | null }[];
  } | null>(null);

  const loadFeeding = useCallback(async () => {
    if (!feedClass) return;
    const res = await fetch(`/api/proxy/registers/feeding?classId=${feedClass}&onDate=${feedDate}`);
    if (res.ok) setFeeding(await res.json());
  }, [feedClass, feedDate]);

  useEffect(() => {
    if (tab === 'feeding') loadFeeding();
  }, [tab, loadFeeding]);

  async function collect(studentId: string) {
    const amount = Number(feedAmount);
    if (!amount) {
      setError('Set the amount being collected first.');
      return;
    }
    await fetch('/api/proxy/registers/feeding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, onDate: feedDate, amount }),
    });
    loadFeeding();
  }

  const visible = TABS.filter((t) => held.includes(t.needs));

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Registers</h1>
        <p className="text-sm text-oat mt-1.5 max-w-prose">
          The books an inspection asks to see. Everything here is dated and signed by whoever wrote
          it, and none of it can be quietly changed afterwards.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-2 rise rise-2">
        {visible.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-11 rounded-lg border px-3.5 text-sm font-medium transition ${
              tab === t.id
                ? 'border-brand bg-brand-mist/50 text-brand'
                : 'border-mist bg-white text-oat hover:text-brand'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger mt-4">
          {error}
        </p>
      )}

      {tab === 'logbook' && (
        <div className="card p-6 mt-6 rise rise-2">
          <form onSubmit={writeLog.run} className="flex flex-wrap items-end gap-3">
            <label className="flex-1 min-w-[16rem]">
              <span className="text-xs uppercase tracking-widest text-oat">What happened</span>
              <textarea
                value={logBody}
                onChange={(e) => setLogBody(e.target.value)}
                required
                minLength={3}
                rows={2}
                placeholder="District officer called unannounced at 10.15."
                className={`${field} mt-1.5 w-full`}
              />
            </label>
            <select value={logKind} onChange={(e) => setLogKind(e.target.value)} className={field}>
              {['GENERAL', 'VISIT', 'INCIDENT', 'ABSENCE', 'MAINTENANCE'].map((k) => (
                <option key={k} value={k}>
                  {k.charAt(0) + k.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
            <Button type="submit" state={writeLog.state} icon={<SaveIcon />}>
              Write entry
            </Button>
          </form>
          <ul className="mt-5 divide-y divide-mist/60">
            {rows.map((r) => (
              <li key={r.id} className="py-3">
                <p className="text-sm">{String(r.body)}</p>
                <p className="text-[11px] text-oat mt-0.5">
                  {fmt(String(r.entryDate))} · {String(r.kind).toLowerCase()} ·{' '}
                  {String(r.authorName)}
                </p>
              </li>
            ))}
            {rows.length === 0 && <li className="py-3 text-sm text-oat">Nothing recorded yet.</li>}
          </ul>
        </div>
      )}

      {tab === 'duty' && (
        <div className="card p-6 mt-6 rise rise-2">
          {held.includes('registers.duty') && (
            <form onSubmit={assignDuty.run} className="flex flex-wrap items-end gap-3">
              <select
                value={dutyUser}
                onChange={(e) => setDutyUser(e.target.value)}
                required
                className={field}
              >
                <option value="">Who is on duty…</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={dutyFrom}
                onChange={(e) => setDutyFrom(e.target.value)}
                required
                className={field}
              />
              <input
                type="date"
                value={dutyTo}
                onChange={(e) => setDutyTo(e.target.value)}
                required
                className={field}
              />
              <Button type="submit" state={assignDuty.state}>
                Assign
              </Button>
            </form>
          )}
          <ul className="mt-5 divide-y divide-mist/60">
            {rows.map((r) => (
              <li key={r.id} className="py-3 flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium w-40">{String(r.name)}</span>
                <span className="text-oat text-xs">
                  {fmt(String(r.startDate))} – {fmt(String(r.endDate))}
                </span>
                {r.note ? <span className="text-oat text-xs">· {String(r.note)}</span> : null}
              </li>
            ))}
            {rows.length === 0 && (
              <li className="py-3 text-sm text-oat">Nobody is rostered yet.</li>
            )}
          </ul>
        </div>
      )}

      {tab === 'notes' && (
        <div className="card p-6 mt-6 rise rise-2">
          <form onSubmit={submitNote.run} className="flex flex-wrap items-end gap-3">
            <label className="flex-1 min-w-[12rem]">
              <span className="text-xs uppercase tracking-widest text-oat">Title</span>
              <input
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                required
                minLength={3}
                placeholder="Fractions — week 4"
                className={`${field} mt-1.5 w-full`}
              />
            </label>
            <label>
              <span className="text-xs uppercase tracking-widest text-oat">Week beginning</span>
              <input
                type="date"
                value={noteWeek}
                onChange={(e) => setNoteWeek(e.target.value)}
                required
                className={`${field} mt-1.5 block`}
              />
            </label>
            <label className="w-full">
              <span className="text-xs uppercase tracking-widest text-oat">Notes</span>
              <textarea
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                rows={2}
                className={`${field} mt-1.5 w-full`}
              />
            </label>
            <Button type="submit" state={submitNote.state} icon={<SaveIcon />}>
              Submit for vetting
            </Button>
          </form>
          <ul className="mt-5 divide-y divide-mist/60">
            {rows.map((r) => (
              <li key={r.id} className="py-3 flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium flex-1 min-w-[10rem]">{String(r.title)}</span>
                <span className="text-[11px] text-oat">{String(r.teacherName)}</span>
                <span className="text-[11px] text-oat">{fmt(String(r.weekOf))}</span>
                <span
                  className={`text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 ${
                    r.status === 'APPROVED'
                      ? 'bg-leaf/10 text-leaf'
                      : r.status === 'RETURNED'
                        ? 'bg-danger/10 text-danger'
                        : 'bg-parchment text-oat'
                  }`}
                >
                  {String(r.status).toLowerCase()}
                </span>
                {held.includes('registers.vet_notes') && r.status === 'SUBMITTED' && (
                  <span className="flex gap-2">
                    <button
                      onClick={() =>
                        post(`/registers/lesson-notes/${r.id}/vet`, { status: 'APPROVED' }, 'PATCH')
                      }
                      className="text-[12px] font-medium text-brand hover:underline underline-offset-2"
                    >
                      Approve
                    </button>
                    <ConfirmButton
                      label="Return"
                      question="Return this note for changes?"
                      confirmLabel="Return"
                      reason={{ label: 'What needs changing?' }}
                      triggerClassName="text-[12px] font-medium text-oat hover:text-danger"
                      onConfirm={(comment) =>
                        post(
                          `/registers/lesson-notes/${r.id}/vet`,
                          { status: 'RETURNED', comment },
                          'PATCH',
                        )
                      }
                    />
                  </span>
                )}
                {r.comment ? (
                  <span className="w-full text-[11px] text-danger">{String(r.comment)}</span>
                ) : null}
              </li>
            ))}
            {rows.length === 0 && <li className="py-3 text-sm text-oat">No lesson notes yet.</li>}
          </ul>
        </div>
      )}

      {tab === 'discipline' && (
        <div className="card p-6 mt-6 rise rise-2">
          <p className="text-[13px] text-oat max-w-prose">
            Record what happened and what was done about it. These follow a child through the
            school, so they are written for the next person to read, not for today.
          </p>
          <ul className="mt-4 divide-y divide-mist/60">
            {rows.map((r) => (
              <li key={r.id} className="py-3">
                <p className="text-sm">
                  <span className="font-medium">{String(r.studentName)}</span>{' '}
                  <span className="text-oat text-xs tabular">{String(r.admissionNo)}</span>
                </p>
                <p className="text-sm mt-0.5">{String(r.description)}</p>
                {r.actionTaken ? (
                  <p className="text-[12px] text-oat mt-0.5">Action: {String(r.actionTaken)}</p>
                ) : null}
                <p className="text-[11px] text-oat mt-0.5">
                  {fmt(String(r.occurredOn))} · {String(r.outcome).replace(/_/g, ' ').toLowerCase()}
                  {r.guardianInformedAt
                    ? ` · family told ${fmt(String(r.guardianInformedAt))}`
                    : ''}
                </p>
              </li>
            ))}
            {rows.length === 0 && <li className="py-3 text-sm text-oat">Nothing recorded.</li>}
          </ul>
        </div>
      )}

      {tab === 'visitors' && (
        <div className="card p-6 mt-6 rise rise-2">
          <form onSubmit={signIn.run} className="flex flex-wrap items-end gap-3">
            {(
              [
                ['name', 'Name'],
                ['organisation', 'From'],
                ['toSee', 'To see'],
                ['purpose', 'Purpose'],
                ['phone', 'Phone'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="min-w-[9rem] flex-1">
                <span className="text-xs uppercase tracking-widest text-oat">{label}</span>
                <input
                  value={visitor[k]}
                  onChange={(e) => setVisitor({ ...visitor, [k]: e.target.value })}
                  required={k === 'name' || k === 'purpose'}
                  className={`${field} mt-1.5 w-full`}
                />
              </label>
            ))}
            <Button type="submit" state={signIn.state}>
              Sign in
            </Button>
          </form>
          <ul className="mt-5 divide-y divide-mist/60">
            {rows.map((r) => (
              <li key={r.id} className="py-3 flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium min-w-[9rem]">{String(r.name)}</span>
                <span className="text-oat text-xs">{String(r.organisation ?? '')}</span>
                <span className="text-oat text-xs flex-1">{String(r.purpose)}</span>
                <span className="text-oat text-xs">{fmtTime(String(r.arrivedAt))}</span>
                {r.departedAt ? (
                  <span className="text-oat text-xs">out {fmtTime(String(r.departedAt))}</span>
                ) : (
                  <button
                    onClick={() => post(`/registers/visitors/${r.id}/out`, {}, 'PATCH')}
                    className="text-[12px] font-medium text-brand hover:underline underline-offset-2"
                  >
                    Sign out
                  </button>
                )}
              </li>
            ))}
            {rows.length === 0 && <li className="py-3 text-sm text-oat">No visitors logged.</li>}
          </ul>
        </div>
      )}

      {tab === 'feeding' && (
        <div className="card p-6 mt-6 rise rise-2">
          <div className="flex flex-wrap items-end gap-3">
            <select
              value={feedClass}
              onChange={(e) => setFeedClass(e.target.value)}
              className={field}
            >
              <option value="">Choose a class…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={feedDate}
              onChange={(e) => setFeedDate(e.target.value)}
              className={field}
            />
            <label>
              <span className="text-xs uppercase tracking-widest text-oat">
                Today&rsquo;s amount
              </span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={feedAmount}
                onChange={(e) => setFeedAmount(e.target.value)}
                placeholder="5"
                className={`${field} mt-1.5 block w-28`}
              />
            </label>
          </div>
          {feeding && (
            <>
              <p className="text-sm text-oat mt-4">
                {feeding.paidCount} paid ·{' '}
                <span className="text-danger">{feeding.unpaidCount} outstanding</span> · collected{' '}
                {feeding.collected.toFixed(2)}
              </p>
              <ul className="mt-3 divide-y divide-mist/60">
                {feeding.rows.map((r) => (
                  <li key={r.studentId} className="py-2 flex items-center gap-3 text-sm">
                    <span className="flex-1">{r.name}</span>
                    <span className="text-oat text-xs tabular">{r.admissionNo}</span>
                    {r.amount !== null ? (
                      <span className="text-leaf text-xs tabular">{r.amount.toFixed(2)}</span>
                    ) : (
                      <button
                        onClick={() => collect(r.studentId)}
                        className="min-h-9 rounded-lg border border-mist px-3 text-[12px] font-medium text-brand hover:bg-brand-mist/40 transition"
                      >
                        Collect
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
