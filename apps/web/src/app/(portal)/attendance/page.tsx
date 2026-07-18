'use client';

import { useCallback, useEffect, useState } from 'react';
import Combobox from '@/components/Combobox';
import OfflineBar from '@/components/OfflineBar';
import { submitOrQueue } from '@/lib/offline';
import Link from 'next/link';

interface RosterRow {
  id: string;
  admissionNo: string;
  name: string;
  status: string | null;
}
interface ClassOpt {
  id: string;
  name: string;
  studentCount: number;
}

const STATUSES = [
  { key: 'PRESENT', label: 'Present', cls: 'bg-brand text-paper border-brand' },
  { key: 'LATE', label: 'Late', cls: 'bg-gold text-ink border-gold' },
  { key: 'ABSENT', label: 'Absent', cls: 'bg-danger text-paper border-danger' },
  { key: 'EXCUSED', label: 'Excused', cls: 'bg-oat text-paper border-oat' },
];

export default function AttendancePage() {
  const [classes, setClasses] = useState<ClassOpt[]>([]);
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [queued, setQueued] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    fetch('/api/proxy/school/structure')
      .then((r) => r.json())
      .then((s) => {
        const withStudents = s.classes.filter((c: ClassOpt) => c.studentCount > 0);
        setClasses(withStudents);
        if (withStudents[0]) setClassId(withStudents[0].id);
      });
  }, []);

  const loadRoster = useCallback(async () => {
    if (!classId) return;
    setLoading(true);
    const res = await fetch(`/api/proxy/attendance/roster?classId=${classId}&date=${date}`);
    setRows(await res.json());
    setLoading(false);
  }, [classId, date]);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  function setStatus(studentId: string, status: string) {
    setRows((rs) => rs.map((r) => (r.id === studentId ? { ...r, status } : r)));
    setSaveState('idle');
  }

  function markAll(status: string) {
    setRows((rs) => rs.map((r) => ({ ...r, status })));
    setSaveState('idle');
  }

  async function save() {
    setSaveState('saving');
    const entries = rows
      .filter((r) => r.status)
      .map((r) => ({ studentId: r.id, status: r.status }));
    const className = classes.find((c) => c.id === classId)?.name ?? 'class';
    // Marking is an upsert keyed on (student, date), so replaying it offline is safe.
    const res = await submitOrQueue(
      '/api/proxy/attendance/mark',
      { classId, date, entries },
      `${className} register · ${date}`,
    );
    setQueued(res.queued);
    setSaveState(res.ok ? 'saved' : 'error');
    if (!res.ok) setErrorMsg(res.message ?? 'That did not save.');
  }

  const marked = rows.filter((r) => r.status).length;

  return (
    <div>
      <OfflineBar />
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Attendance</h1>
        <p className="text-sm text-oat mt-1.5">
          Mark the daily register — tap a status for each child.{' '}
          <Link href="/attendance/trends" className="text-brand underline underline-offset-2">
            See attendance patterns →
          </Link>
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3 rise rise-2">
        <Combobox
          label="Class"
          className="w-full sm:w-60"
          allowClear={false}
          placeholder="Search classes…"
          options={classes.map((c) => ({
            value: c.id,
            label: c.name,
            hint: `${c.studentCount} student${c.studentCount === 1 ? '' : 's'}`,
          }))}
          value={classId}
          onChange={setClassId}
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Date"
          className="rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand tabular"
        />
        <button
          onClick={() => markAll('PRESENT')}
          data-tip="Set every child to Present, then adjust exceptions"
          className="tip rounded-lg border border-brand text-brand text-sm font-medium px-4 py-2 hover:bg-brand-mist transition"
        >
          All present
        </button>
        <div className="ml-auto flex items-center gap-3">
          <p className="text-[13px] text-oat tabular">
            {marked}/{rows.length} marked
          </p>
          <button
            onClick={save}
            disabled={saveState === 'saving' || marked === 0}
            className="rounded-lg bg-brand text-paper text-sm font-medium px-5 py-2 hover:bg-brand-deep transition disabled:opacity-50"
          >
            {saveState === 'saving' ? 'Saving…' : 'Save register'}
          </button>
        </div>
      </div>

      {saveState === 'saved' && (
        <p
          role="status"
          className="mt-3 text-sm text-leaf bg-leaf/10 border border-leaf/20 rounded-lg px-3 py-2 rise"
        >
          {queued
            ? 'Register saved on this device — it will sync when the connection returns.'
            : 'Register saved. Guardians of absent children are texted automatically.'}
        </p>
      )}
      {saveState === 'error' && (
        <p
          role="alert"
          className="mt-3 text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2"
        >
          {errorMsg || 'Could not save the register — please try again.'}
        </p>
      )}

      <div className="card mt-5 overflow-hidden rise rise-3">
        {loading ? (
          <p className="p-8 text-center text-oat text-sm">Loading roster…</p>
        ) : (
          <ul>
            {rows.map((r, i) => (
              <li
                key={r.id}
                className={`flex items-center justify-between gap-4 px-5 py-3 ${i > 0 ? 'border-t border-mist/60' : ''}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.name}</p>
                  <p className="text-[11px] text-oat tabular">{r.admissionNo}</p>
                </div>
                <div
                  className="flex gap-1.5 shrink-0"
                  role="radiogroup"
                  aria-label={`Status for ${r.name}`}
                >
                  {STATUSES.map((s) => (
                    <button
                      key={s.key}
                      role="radio"
                      aria-checked={r.status === s.key}
                      onClick={() => setStatus(r.id, s.key)}
                      className={`text-[12px] rounded-full border px-3 py-1.5 transition ${
                        r.status === s.key
                          ? s.cls
                          : 'border-mist bg-white text-oat hover:border-brand hover:text-brand'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="p-8 text-center text-oat text-sm">No students in this class.</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
