'use client';

import { useCallback, useEffect, useState } from 'react';
import Combobox from '@/components/Combobox';
import { Button, useAsyncAction } from '@/components/Button';
import ConfirmButton from '@/components/ConfirmButton';

/**
 * LMS (lms.core) — the teacher's side: publish a lesson to a class, set an assignment with a due
 * date, and grade what pupils submit from home. Pick a class, and everything below is that class.
 */
interface Lesson {
  id: string;
  title: string;
  subject: string;
  content: string;
  createdAt: string;
}
interface Assignment {
  id: string;
  title: string;
  subject: string;
  dueAt: string;
  points: number;
  submissions: number;
  graded: number;
  overdue: boolean;
}
interface ClassData {
  className: string;
  roster: number;
  lessons: Lesson[];
  assignments: Assignment[];
}
interface Structure {
  classes: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
}

const field =
  'min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';
const area =
  'rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';
const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });

export default function LmsPage() {
  const [structure, setStructure] = useState<Structure | null>(null);
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [data, setData] = useState<ClassData | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [openAssignment, setOpenAssignment] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/proxy/school/structure')
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Structure | null) => {
        setStructure(s);
        if (s?.classes[0]) setClassId(s.classes[0].id);
        if (s?.subjects[0]) setSubjectId(s.subjects[0].id);
      })
      .catch(() => {});
    fetch('/api/proxy/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => setCanManage((me?.permissions ?? []).includes('lms.manage')))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!classId) return;
    const res = await fetch(`/api/proxy/lms?classId=${classId}`);
    if (res.ok) setData(await res.json());
  }, [classId]);

  useEffect(() => {
    load();
  }, [load]);

  async function send(path: string, body?: unknown, method = 'POST') {
    setError(null);
    const res = await fetch(`/api/proxy${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        Array.isArray(d.message) ? d.message.join('. ') : (d.message ?? 'That did not work.'),
      );
      throw new Error('rejected');
    }
    await load();
    return d;
  }

  // new lesson
  const [lTitle, setLTitle] = useState('');
  const [lContent, setLContent] = useState('');
  const addLesson = useAsyncAction(async () => {
    await send('/lms/lessons', { classId, subjectId, title: lTitle, content: lContent });
    setLTitle('');
    setLContent('');
  });

  // new assignment
  const [aTitle, setATitle] = useState('');
  const [aInstr, setAInstr] = useState('');
  const [aDue, setADue] = useState('');
  const [aPoints, setAPoints] = useState('100');
  const addAssignment = useAsyncAction(async () => {
    await send('/lms/assignments', {
      classId,
      subjectId,
      title: aTitle,
      instructions: aInstr,
      dueAt: aDue,
      points: Number(aPoints) || 100,
    });
    setATitle('');
    setAInstr('');
    setADue('');
  });

  const subjectOptions = (structure?.subjects ?? []).map((s) => ({ value: s.id, label: s.name }));

  return (
    <div className="max-w-4xl">
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Lessons</h1>
        <p className="text-sm text-oat mt-1.5 max-w-prose">
          Publish a lesson to a class, set an assignment with a due date, and grade what pupils send
          back — beyond a shared file, a place work is handed in and marked.
        </p>
      </div>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      <div className="mt-6 flex flex-wrap items-end gap-4 rise rise-2">
        <div className="w-56">
          <Combobox
            label="Class"
            options={(structure?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))}
            value={classId}
            onChange={setClassId}
            placeholder="Pick a class…"
          />
        </div>
        {canManage && (
          <div className="w-56">
            <Combobox
              label="Subject (for new items)"
              options={subjectOptions}
              value={subjectId}
              onChange={setSubjectId}
              placeholder="Pick a subject…"
            />
          </div>
        )}
        {data && (
          <p className="text-[12px] text-oat pb-2">
            {data.className} · {data.roster} pupil{data.roster === 1 ? '' : 's'}
          </p>
        )}
      </div>

      <div className="mt-6 grid lg:grid-cols-2 gap-5">
        {/* Lessons */}
        <section className="card p-5">
          <h2 className="font-display text-lg">Lessons</h2>
          <ul className="mt-3 space-y-2">
            {(data?.lessons ?? []).map((l) => (
              <li
                key={l.id}
                className="flex items-start justify-between gap-3 text-sm border-b border-mist/40 pb-2 last:border-0"
              >
                <span>
                  <span className="font-medium">{l.title}</span>
                  <span className="block text-[12px] text-oat">
                    {l.subject} · {fmt(l.createdAt)}
                  </span>
                </span>
                {canManage && (
                  <ConfirmButton
                    label="Delete"
                    question="Delete this lesson?"
                    confirmLabel="Delete"
                    danger
                    triggerClassName="text-[11px] text-clay hover:underline underline-offset-2 shrink-0"
                    onConfirm={() => send(`/lms/lessons/${l.id}`, undefined, 'DELETE')}
                  />
                )}
              </li>
            ))}
            {data && data.lessons.length === 0 && (
              <li className="text-[13px] text-oat">No lessons yet.</li>
            )}
          </ul>

          {canManage && (
            <form
              className="mt-4 border-t border-mist/50 pt-4 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                addLesson.run();
              }}
            >
              <input
                className={`${field} block w-full`}
                placeholder="Lesson title"
                value={lTitle}
                onChange={(e) => setLTitle(e.target.value)}
              />
              <textarea
                className={`${area} block w-full`}
                rows={3}
                placeholder="Lesson notes for the class…"
                value={lContent}
                onChange={(e) => setLContent(e.target.value)}
              />
              <Button
                size="sm"
                state={addLesson.state}
                disabled={!lTitle.trim() || !lContent.trim()}
              >
                Publish lesson
              </Button>
            </form>
          )}
        </section>

        {/* Assignments */}
        <section className="card p-5">
          <h2 className="font-display text-lg">Assignments</h2>
          <ul className="mt-3 space-y-2">
            {(data?.assignments ?? []).map((a) => (
              <li key={a.id} className="border-b border-mist/40 pb-2 last:border-0">
                <div className="flex items-start justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium">{a.title}</span>
                    <span className="block text-[12px] text-oat">
                      {a.subject} · due {fmt(a.dueAt)}
                      {a.overdue ? <span className="text-clay"> · closed</span> : null}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpenAssignment(openAssignment === a.id ? null : a.id)}
                    className="text-[12px] font-medium text-brand hover:underline underline-offset-2 shrink-0"
                  >
                    {a.graded}/{a.submissions} graded →
                  </button>
                </div>
                {openAssignment === a.id && (
                  <Submissions assignmentId={a.id} canManage={canManage} onGraded={load} />
                )}
              </li>
            ))}
            {data && data.assignments.length === 0 && (
              <li className="text-[13px] text-oat">No assignments yet.</li>
            )}
          </ul>

          {canManage && (
            <form
              className="mt-4 border-t border-mist/50 pt-4 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                addAssignment.run();
              }}
            >
              <input
                className={`${field} block w-full`}
                placeholder="Assignment title"
                value={aTitle}
                onChange={(e) => setATitle(e.target.value)}
              />
              <textarea
                className={`${area} block w-full`}
                rows={2}
                placeholder="Instructions…"
                value={aInstr}
                onChange={(e) => setAInstr(e.target.value)}
              />
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[12px] text-oat">
                  Due
                  <input
                    type="datetime-local"
                    className={`${field} mt-1 block`}
                    value={aDue}
                    onChange={(e) => setADue(e.target.value)}
                  />
                </label>
                <label className="text-[12px] text-oat">
                  Marks
                  <input
                    type="number"
                    min={1}
                    className={`${field} mt-1 block w-20`}
                    value={aPoints}
                    onChange={(e) => setAPoints(e.target.value)}
                  />
                </label>
                <Button
                  size="sm"
                  state={addAssignment.state}
                  disabled={!aTitle.trim() || !aInstr.trim() || !aDue}
                >
                  Set assignment
                </Button>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

interface SubDetail {
  assignment: { id: string; title: string; points: number; dueAt: string };
  submissions: {
    id: string;
    studentId: string;
    name: string;
    admissionNo: string | null;
    text: string;
    submittedAt: string;
    score: number | null;
    feedback: string | null;
  }[];
  notSubmitted: { studentId: string; name: string }[];
}

function Submissions({
  assignmentId,
  canManage,
  onGraded,
}: {
  assignmentId: string;
  canManage: boolean;
  onGraded: () => void;
}) {
  const [detail, setDetail] = useState<SubDetail | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/proxy/lms/assignments/${assignmentId}/submissions`);
    if (res.ok) setDetail(await res.json());
  }, [assignmentId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!detail) return <p className="mt-2 text-[12px] text-oat">Loading…</p>;

  return (
    <div className="mt-2 rounded-lg bg-parchment/40 p-3">
      {detail.submissions.length === 0 && (
        <p className="text-[12px] text-oat">Nobody has submitted yet.</p>
      )}
      <ul className="space-y-3">
        {detail.submissions.map((s) => (
          <li key={s.id} className="text-[13px]">
            <div className="flex items-center justify-between">
              <span className="font-medium">{s.name}</span>
              <span className="text-oat">
                {s.score != null ? `${s.score}/${detail.assignment.points}` : 'ungraded'}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-ink/80">{s.text}</p>
            {canManage && (
              <GradeForm
                submissionId={s.id}
                points={detail.assignment.points}
                initialScore={s.score}
                initialFeedback={s.feedback}
                onDone={async () => {
                  await load();
                  onGraded();
                }}
              />
            )}
            {!canManage && s.feedback && (
              <p className="mt-1 text-[12px] text-oat">Feedback: {s.feedback}</p>
            )}
          </li>
        ))}
      </ul>
      {detail.notSubmitted.length > 0 && (
        <p className="mt-3 text-[12px] text-oat">
          Not yet in: {detail.notSubmitted.map((n) => n.name).join(', ')}
        </p>
      )}
    </div>
  );
}

function GradeForm({
  submissionId,
  points,
  initialScore,
  initialFeedback,
  onDone,
}: {
  submissionId: string;
  points: number;
  initialScore: number | null;
  initialFeedback: string | null;
  onDone: () => Promise<void> | void;
}) {
  const [score, setScore] = useState(initialScore != null ? String(initialScore) : '');
  const [feedback, setFeedback] = useState(initialFeedback ?? '');
  const grade = useAsyncAction(async () => {
    const res = await fetch(`/api/proxy/lms/submissions/${submissionId}/grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: Number(score), feedback }),
    });
    if (!res.ok) throw new Error('rejected');
    await onDone();
  });

  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        grade.run();
      }}
    >
      <input
        type="number"
        min={0}
        max={points}
        className={`${field} w-20`}
        placeholder="Score"
        value={score}
        onChange={(e) => setScore(e.target.value)}
      />
      <span className="text-[12px] text-oat">/ {points}</span>
      <input
        className={`${field} flex-1 min-w-[8rem]`}
        placeholder="Feedback (optional)"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
      />
      <Button size="sm" variant="secondary" state={grade.state} disabled={score === ''}>
        Save mark
      </Button>
    </form>
  );
}
