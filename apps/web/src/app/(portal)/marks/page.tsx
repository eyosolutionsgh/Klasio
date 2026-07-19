'use client';

import { useCallback, useEffect, useState } from 'react';
import Combobox from '@/components/Combobox';
import OfflineBar from '@/components/OfflineBar';
import { Button, useAsyncAction, type ActionState } from '@/components/Button';
import { PlusIcon, SaveIcon } from '@/components/icons';
import { submitOrQueue } from '@/lib/offline';

interface Component {
  id: string;
  name: string;
  maxScore: number;
  category: 'CONTINUOUS' | 'EXAM';
  subjectId: string | null;
  levelId: string | null;
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
  const [addingComponent, setAddingComponent] = useState(false);
  const [componentError, setComponentError] = useState('');

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

  /**
   * The save button reads its state off `saveState` instead of being driven by `useAsyncAction`.
   * Autosave saves too, so the lifecycle is not the button's to own — and the hook returns to
   * idle a couple of seconds after an outcome, which would erase the very "error" state that
   * stops the timer re-sending a save the server has already refused.
   */
  const saveButtonState: ActionState =
    saveState === 'saving'
      ? 'pending'
      : saveState === 'saved'
        ? 'done'
        : saveState === 'error'
          ? 'failed'
          : 'idle';

  const addComponent = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    const f = new FormData(e.currentTarget);
    const res = await fetch('/api/proxy/assessment/components', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: String(f.get('name') ?? '').trim(),
        maxScore: Number(f.get('maxScore')),
        category: String(f.get('category')),
        // Scoped to what the teacher is actually marking, unless they widen it.
        subjectId: f.get('scope') === 'SUBJECT' ? subjectId : undefined,
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      // The server's reason — a clashing name, a bad maximum — is what the teacher has to act
      // on; the button can only say it did not work.
      setComponentError(
        Array.isArray(d.message) ? d.message.join('. ') : (d.message ?? 'Could not add that.'),
      );
      throw new Error('component rejected');
    }
    setAddingComponent(false);
    setComponentError('');
    load();
  });

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
          {/*
            Only the "it will save itself in a moment" case is left here. "Saving…" and "All
            changes saved" are now the button's own wording, and repeating them beside it just
            gave a screen reader the same news twice.
          */}
          <p className="text-[13px] text-oat">
            {dirty && saveState !== 'saving' ? 'Saving shortly…' : ''}
          </p>
          <Button onClick={save} disabled={!dirty} state={saveButtonState} icon={<SaveIcon />}>
            Save now
          </Button>
        </div>
      </div>

      {/*
        Only the queued case still says anything. A plain "Scores saved." was the button's tick
        written out again; "saved on this device, not yet on the server" is not, and a teacher
        about to close the laptop needs to read it.
      */}
      {saveState === 'saved' && queued && (
        <p
          role="status"
          className="mt-3 text-sm text-leaf bg-leaf/10 border border-leaf/20 rounded-lg px-3 py-2 rise"
        >
          Scores saved on this device — they will sync when the connection returns.
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

      <div className="mt-5 rise rise-3">
        {addingComponent ? (
          <form onSubmit={addComponent.run} className="card p-4 flex flex-wrap items-end gap-3">
            <label className="text-[13px]">
              <span className="block text-oat mb-1">Assessment name</span>
              <input
                name="name"
                required
                minLength={2}
                placeholder="Assignment 3"
                className="min-h-11 rounded-lg border border-mist bg-white px-3 py-2 text-sm w-44 outline-none focus:border-brand"
              />
            </label>
            <label className="text-[13px]">
              <span className="block text-oat mb-1">Out of</span>
              <input
                name="maxScore"
                type="number"
                min="1"
                defaultValue="20"
                required
                className="min-h-11 rounded-lg border border-mist bg-white px-3 py-2 text-sm w-24 tabular outline-none focus:border-brand"
              />
            </label>
            <label className="text-[13px]">
              <span className="block text-oat mb-1">Counts as</span>
              <select
                name="category"
                defaultValue="CONTINUOUS"
                className="min-h-11 rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand"
              >
                <option value="CONTINUOUS">Continuous assessment</option>
                <option value="EXAM">Exam</option>
              </select>
            </label>
            <label className="text-[13px]">
              <span className="block text-oat mb-1">Applies to</span>
              <select
                name="scope"
                defaultValue="SUBJECT"
                className="min-h-11 rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand"
              >
                <option value="SUBJECT">This subject only</option>
                <option value="ALL">Every subject</option>
              </select>
            </label>
            <Button type="submit" state={addComponent.state} icon={<PlusIcon />}>
              Add column
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAddingComponent(false)}>
              Cancel
            </Button>
            {componentError && <p className="w-full text-sm text-danger">{componentError}</p>}
          </form>
        ) : (
          // The leading "+" is now the icon, so it is gone from the label.
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={<PlusIcon />}
            onClick={() => setAddingComponent(true)}
            disabled={!subjectId}
          >
            Add an assessment
          </Button>
        )}
      </div>

      {/*
        Not paged, on purpose.

        This is one class's column of marks, saved as a single request that replays the whole
        column — `save` builds `entries` from every row on screen. Paging it would mean a teacher
        who scrolled to page 2 and let autosave fire submitted only the second half of the class,
        and the API would take that as the complete answer. The list is bounded by class size, which
        is the natural limit here; the register is what gets paged, not the marks sheet.
      */}
      <div className="card mt-3 overflow-x-auto rise rise-3 table-stack-wrap">
        {/* The minimum width applies only where the table is still a table — below `sm` the rows
            are stacked cards and a 640px floor would put the whole page in sideways scroll. */}
        <table className="w-full text-sm sm:min-w-[640px] table-stack">
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
                    {c.category === 'EXAM' ? ' · exam' : ''}
                    {c.subjectId ? ' · this subject' : ''}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.studentId} className="border-b border-mist/60 last:border-0">
                <td data-label="Student" className="px-5 py-2">
                  <p className="font-medium">{r.name}</p>
                  <p className="text-[11px] text-oat tabular">{r.admissionNo}</p>
                </td>
                {components.map((c) => (
                  // The label carries the maximum as well as the name: stacked on a phone the
                  // column heading that said "/20" is no longer above the box being typed into.
                  <td
                    key={c.id}
                    data-label={`${c.name} /${c.maxScore}`}
                    className="px-3 py-2 text-center"
                  >
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
