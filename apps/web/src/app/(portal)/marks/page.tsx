'use client';

import { useCallback, useEffect, useState } from 'react';

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

  async function save() {
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
    const res = await fetch('/api/proxy/assessment/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ termId, subjectId, classId, entries }),
    });
    if (res.ok) {
      setSaveState('saved');
      setDirty(false);
    } else {
      const body = await res.json().catch(() => ({}));
      setErrorMsg(body.message ?? 'Could not save scores.');
      setSaveState('error');
    }
  }

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Marks entry</h1>
        <p className="text-sm text-oat mt-1.5">
          Enter continuous assessment and exam scores. SBA scales to 30, exam to 70 on the terminal
          report.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 rise rise-2">
        <select
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          aria-label="Class"
          className="rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-forest"
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          aria-label="Subject"
          className="rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-forest"
        >
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-3">
          {dirty && <p className="text-[13px] text-clay">Unsaved changes</p>}
          <button
            onClick={save}
            disabled={saveState === 'saving' || !dirty}
            className="rounded-lg bg-forest text-paper text-sm font-medium px-5 py-2 hover:bg-forest-deep transition disabled:opacity-50"
          >
            {saveState === 'saving' ? 'Saving…' : 'Save scores'}
          </button>
        </div>
      </div>

      {saveState === 'saved' && (
        <p
          role="status"
          className="mt-3 text-sm text-leaf bg-leaf/10 border border-leaf/20 rounded-lg px-3 py-2 rise"
        >
          Scores saved.
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
                      className="w-16 rounded-md border border-mist bg-white px-2 py-1.5 text-center tabular outline-none focus:border-forest focus:ring-2 focus:ring-forest/15"
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
