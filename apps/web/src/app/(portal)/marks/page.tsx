'use client';

import { useCallback, useEffect, useState } from 'react';
import Combobox from '@/components/Combobox';
import OfflineBar from '@/components/OfflineBar';
import { submitOrQueue } from '@/lib/offline';

interface Component {
  id: string;
  name: string;
  maxScore: number;
  isExam: boolean;
}
interface Row {
  studentId: string;
  admissionNo: string;
  name: string;
  scores: Record<string, number | null>;
}
interface ClassOpt {
  id: string;
  name: string;
  studentCount: number;
}
interface SubjectOpt {
  id: string;
  name: string;
}

export default function MarksPage() {
  const [classes, setClasses] = useState<ClassOpt[]>([]);
  const [subjects, setSubjects] = useState<SubjectOpt[]>([]);
  const [termId, setTermId] = useState('');
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [components, setComponents] = useState<Component[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [queued, setQueued] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/proxy/school/structure').then((r) => r.json()),
      fetch('/api/proxy/me').then((r) => r.json()),
    ]).then(([s, me]) => {
      const withStudents = s.classes.filter((c: ClassOpt) => c.studentCount > 0);
      setClasses(withStudents);
      setSubjects(s.subjects);
      if (withStudents[0]) setClassId(withStudents[0].id);
      if (s.subjects[0]) setSubjectId(s.subjects[0].id);
      if (me.currentTerm) setTermId(me.currentTerm.id);
    });
  }, []);

  const load = useCallback(async () => {
    if (!classId || !subjectId || !termId) return;
    const res = await fetch(
      `/api/proxy/assessment/scores?classId=${classId}&subjectId=${subjectId}&termId=${termId}`,
    );
    const data = await res.json();
    setComponents(data.components);
    setRows(data.rows);
    setDirty(false);
    setSaveState('idle');
  }, [classId, subjectId, termId]);

  useEffect(() => {
    load();
  }, [load]);

  function setScore(studentId: string, componentId: string, value: string) {
    const num = value === '' ? null : Number(value);
    setRows((rs) =>
      rs.map((r) =>
        r.studentId === studentId ? { ...r, scores: { ...r.scores, [componentId]: num } } : r,
      ),
    );
    setDirty(true);
    setSaveState('idle');
  }

  const save = useCallback(async () => {
    setSaveState('saving');
    setErrorMsg('');
    const entries = rows.flatMap((r) =>
      components
        .map((c) => ({ studentId: r.studentId, componentId: c.id, rawScore: r.scores[c.id] }))
        .filter(
          (e): e is { studentId: string; componentId: string; rawScore: number } =>
            e.rawScore != null,
        ),
    );
    const cls = classes.find((c) => c.id === classId)?.name ?? 'class';
    const subj = subjects.find((x) => x.id === subjectId)?.name ?? 'subject';
    // Scores upsert on (student, component, term), so a replayed save is the same save.
    const res = await submitOrQueue(
      '/api/proxy/assessment/scores',
      { termId, subjectId, classId, entries },
      `${cls} · ${subj} marks`,
    );
    setQueued(res.queued);
    if (res.ok) {
      setSaveState('saved');
      setDirty(false);
    } else {
      setErrorMsg(res.message ?? 'Could not save scores.');
      setSaveState('error');
    }
  }, [rows, components, termId, subjectId, classId, classes, subjects]);

  /**
   * Autosave a moment after typing stops. Marks entry is long and repetitive, and a teacher
   * interrupted mid-column should not lose the column — but saving on every keystroke would
   * hammer the API, so it waits for a pause.
   */
  useEffect(() => {
    if (!dirty || saveState === 'saving') return;
    // Never retry a rejected save on a timer. The server said no — "score exceeds max", say —
    // and repeating it just hammers the API and buries the message. Editing a cell resets the
    // state to idle, which is what lets autosave start again.
    if (saveState === 'error') return;
    const t = setTimeout(() => save(), 1200);
    return () => clearTimeout(t);
  }, [dirty, saveState, save]);

  return (
    <div>
      <OfflineBar />
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Marks entry</h1>
        <p className="text-sm text-oat mt-1.5">
          Enter continuous assessment and exam scores. SBA scales to 30, exam to 70 on the terminal
          report.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3 rise rise-2">
        <Combobox
          label="Class"
          className="w-full sm:w-56"
          allowClear={false}
          placeholder="Search classes…"
          options={classes.map((c) => ({ value: c.id, label: c.name }))}
          value={classId}
          onChange={setClassId}
        />
        <Combobox
          label="Subject"
          className="w-full sm:w-56"
          allowClear={false}
          placeholder="Search subjects…"
          options={subjects.map((s) => ({ value: s.id, label: s.name }))}
          value={subjectId}
          onChange={setSubjectId}
        />
        <div className="ml-auto flex items-center gap-3">
          <p className="text-[13px] text-oat">
            {saveState === 'saving'
              ? 'Saving…'
              : dirty
                ? 'Saving shortly…'
                : saveState === 'saved'
                  ? queued
                    ? 'Saved on this device'
                    : 'All changes saved'
                  : ''}
          </p>
          <button
            onClick={save}
            disabled={saveState === 'saving' || !dirty}
            className="rounded-lg bg-brand text-paper text-sm font-medium px-5 py-2 hover:bg-brand-deep transition disabled:opacity-50"
          >
            {saveState === 'saving' ? 'Saving…' : 'Save now'}
          </button>
        </div>
      </div>

      {saveState === 'saved' && (
        <p
          role="status"
          className="mt-3 text-sm text-leaf bg-leaf/10 border border-leaf/20 rounded-lg px-3 py-2 rise"
        >
          {queued
            ? 'Scores saved on this device — they will sync when the connection returns.'
            : 'Scores saved.'}
        </p>
      )}
      {saveState === 'error' && (
        <p
          role="alert"
          className="mt-3 text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2"
        >
          {errorMsg}
        </p>
      )}

      <div className="card mt-5 overflow-x-auto rise rise-3">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <th className="px-5 py-3 font-medium">Student</th>
              {components.map((c) => (
                <th
                  key={c.id}
                  className="px-3 py-3 font-medium text-center"
                  title={`Out of ${c.maxScore}`}
                >
                  {c.name}
                  <span className="block normal-case tracking-normal text-oat/70">
                    /{c.maxScore}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.studentId} className="border-b border-mist/60 last:border-0">
                <td className="px-5 py-2">
                  <p className="font-medium">{r.name}</p>
                  <p className="text-[11px] text-oat tabular">{r.admissionNo}</p>
                </td>
                {components.map((c) => (
                  <td key={c.id} className="px-3 py-2 text-center">
                    <input
                      type="number"
                      min={0}
                      max={c.maxScore}
                      inputMode="numeric"
                      value={r.scores[c.id] ?? ''}
                      onChange={(e) => setScore(r.studentId, c.id, e.target.value)}
                      aria-label={`${c.name} for ${r.name}`}
                      className="w-16 rounded-md border border-mist bg-white px-2 py-1.5 text-center tabular outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
