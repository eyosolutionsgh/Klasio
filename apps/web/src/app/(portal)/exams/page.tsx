'use client';

import { useCallback, useEffect, useState } from 'react';
import Combobox from '@/components/Combobox';
import { Button, useAsyncAction } from '@/components/Button';
import { PlusIcon } from '@/components/icons';
import AiQuestions from '@/components/AiQuestions';

interface Bank {
  id: string;
  name: string;
  subject: string;
  subjectId: string;
  level: string;
  levelId: string;
  questions: number;
}
interface Question {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
}
interface Exam {
  id: string;
  title: string;
  bank: string;
  subject: string;
  className: string;
  durationMinutes: number;
  questionCount: number;
  status: string;
  attempts: number;
}
interface Results {
  id: string;
  title: string;
  status: string;
  classSize: number;
  attempts: {
    studentId: string;
    name: string;
    admissionNo: string;
    submittedAt: string | null;
    score: number | null;
    total: number | null;
  }[];
}
interface Structure {
  classes: { id: string; name: string }[];
  levels: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
}

const field =
  'min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

/**
 * Question banks and computer-based tests. A bank belongs to a subject at a level; an exam is
 * composed from a bank for one class, auto-marked, and can post its scores straight into the
 * gradebook. Pupils see scores only once the exam is closed — everyone hears together.
 */
export default function ExamsPage() {
  const [structure, setStructure] = useState<Structure | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankId, setBankId] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [results, setResults] = useState<Results | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, b, e] = await Promise.all([
      fetch('/api/proxy/school/structure'),
      fetch('/api/proxy/exams/banks'),
      fetch('/api/proxy/exams'),
    ]);
    if (b.status === 403 || b.status === 404) {
      setDenied(true);
      return;
    }
    if (s.ok) setStructure(await s.json());
    if (b.ok) setBanks(await b.json());
    if (e.ok) setExams(await e.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadQuestions = useCallback(async () => {
    if (!bankId) {
      setQuestions([]);
      return;
    }
    const res = await fetch(`/api/proxy/exams/banks/${bankId}/questions`);
    if (res.ok) setQuestions(await res.json());
  }, [bankId]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  const createBank = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    const f = new FormData(form);
    setError(null);
    const res = await fetch('/api/proxy/exams/banks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: String(f.get('name')),
        subjectId: String(f.get('subjectId')),
        levelId: String(f.get('levelId')),
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? 'Could not create the bank.');
      throw new Error('rejected');
    }
    form.reset();
    load();
  });

  const addQuestion = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    const f = new FormData(form);
    const options = [1, 2, 3, 4].map((i) => String(f.get(`opt${i}`) ?? '').trim()).filter(Boolean);
    setError(null);
    const res = await fetch(`/api/proxy/exams/banks/${bankId}/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: String(f.get('text')),
        options,
        correctIndex: Number(f.get('correctIndex')),
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(Array.isArray(d.message) ? d.message.join('. ') : (d.message ?? 'Could not add.'));
      throw new Error('rejected');
    }
    form.reset();
    loadQuestions();
    load();
  });

  const createExam = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    const f = new FormData(form);
    setError(null);
    const res = await fetch('/api/proxy/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: String(f.get('title')),
        bankId: String(f.get('examBankId')),
        classId: String(f.get('classId')),
        durationMinutes: Number(f.get('durationMinutes')),
        questionCount: Number(f.get('questionCount')),
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(
        Array.isArray(d.message) ? d.message.join('. ') : (d.message ?? 'Could not set the exam.'),
      );
      throw new Error('rejected');
    }
    form.reset();
    load();
  });

  async function setStatus(exam: Exam, status: 'OPEN' | 'CLOSED') {
    const res = await fetch(`/api/proxy/exams/${exam.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      load();
      if (results?.id === exam.id) openResults(exam.id);
    }
  }

  async function openResults(id: string) {
    const res = await fetch(`/api/proxy/exams/${id}/results`);
    if (res.ok) setResults(await res.json());
  }

  const postMarks = useAsyncAction(async () => {
    if (!results) return;
    const res = await fetch(`/api/proxy/exams/${results.id}/post`, { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.message ?? 'Could not post the marks.');
      throw new Error('rejected');
    }
    setError(null);
  });

  if (denied) {
    return (
      <div>
        <div className="rise rise-1">
          <h1 className="font-display text-3xl">Examinations</h1>
        </div>
        <p className="card p-6 mt-6 text-sm text-oat rise rise-2">
          Computer-based tests are part of a higher package. Ask whoever manages your subscription
          about an upgrade.
        </p>
      </div>
    );
  }

  const bank = banks.find((b) => b.id === bankId);

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Examinations</h1>
        <p className="text-sm text-oat mt-1.5">
          Question banks, and computer-based tests marked the moment a pupil submits. Scores can
          post straight into the gradebook.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        <section className="card p-6 rise rise-2">
          <h2 className="font-display text-xl">Question banks</h2>
          {structure && (
            <form onSubmit={createBank.run} className="mt-3 flex flex-wrap gap-2">
              <input
                name="name"
                required
                minLength={2}
                placeholder="e.g. BECE Maths practice"
                className={`${field} w-52`}
              />
              <select name="subjectId" required className={field}>
                <option value="">Subject…</option>
                {structure.subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <select name="levelId" required className={field}>
                <option value="">Level…</option>
                {structure.levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <Button
                type="submit"
                state={createBank.state}
                icon={<PlusIcon />}
                variant="secondary"
              >
                New bank
              </Button>
            </form>
          )}

          <div className="mt-4">
            <Combobox
              label="Bank"
              className="w-full"
              placeholder="Open a bank…"
              options={banks.map((b) => ({
                value: b.id,
                label: b.name,
                hint: `${b.subject} · ${b.level} · ${b.questions} question${b.questions === 1 ? '' : 's'}`,
              }))}
              value={bankId}
              onChange={setBankId}
            />
          </div>

          {bank && (
            <>
              <form
                onSubmit={addQuestion.run}
                className="mt-4 space-y-2 rounded-lg bg-parchment/60 p-4"
              >
                <textarea
                  name="text"
                  required
                  minLength={5}
                  rows={2}
                  placeholder="The question…"
                  className={`${field} w-full`}
                />
                <div className="grid sm:grid-cols-2 gap-2">
                  {[1, 2, 3, 4].map((i) => (
                    <input
                      key={i}
                      name={`opt${i}`}
                      required={i <= 2}
                      placeholder={`Option ${String.fromCharCode(64 + i)}`}
                      className={field}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-[12px] text-oat flex items-center gap-2">
                    Correct answer
                    <select name="correctIndex" required className={field}>
                      {[0, 1, 2, 3].map((i) => (
                        <option key={i} value={i}>
                          {String.fromCharCode(65 + i)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button type="submit" state={addQuestion.state} icon={<PlusIcon />} size="sm">
                    Add question
                  </Button>
                </div>
              </form>

              <AiQuestions
                bankId={bank.id}
                onAdded={() => {
                  loadQuestions();
                  load();
                }}
              />

              <ol className="mt-4 space-y-2 list-decimal pl-5">
                {questions.map((q) => (
                  <li key={q.id} className="text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span>
                        {q.text}
                        <span className="block text-[11px] text-oat">
                          {q.options
                            .map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`)
                            .join('   ')}{' '}
                          — answer {String.fromCharCode(65 + q.correctIndex)}
                        </span>
                      </span>
                      <button
                        onClick={async () => {
                          if (!confirm('Remove this question?')) return;
                          await fetch(`/api/proxy/exams/questions/${q.id}`, { method: 'DELETE' });
                          loadQuestions();
                          load();
                        }}
                        className="text-[12px] text-clay hover:underline underline-offset-2 shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
                {questions.length === 0 && (
                  <li className="text-sm text-oat list-none -ml-5">
                    No questions in this bank yet.
                  </li>
                )}
              </ol>
            </>
          )}
        </section>

        <div className="space-y-6">
          <section className="card p-6 rise rise-3">
            <h2 className="font-display text-xl">Tests</h2>
            {structure && (
              <form onSubmit={createExam.run} className="mt-3 flex flex-wrap gap-2">
                <input
                  name="title"
                  required
                  minLength={2}
                  placeholder="e.g. Mock BECE Paper 1"
                  className={`${field} w-48`}
                />
                <select name="examBankId" required className={field}>
                  <option value="">Bank…</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <select name="classId" required className={field}>
                  <option value="">Class…</option>
                  {structure.classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <label className="text-[11px] text-oat">
                  mins
                  <input
                    name="durationMinutes"
                    type="number"
                    min={1}
                    max={300}
                    defaultValue={30}
                    className={`${field} block w-20 tabular`}
                  />
                </label>
                <label className="text-[11px] text-oat">
                  questions
                  <input
                    name="questionCount"
                    type="number"
                    min={1}
                    max={200}
                    defaultValue={20}
                    className={`${field} block w-20 tabular`}
                  />
                </label>
                <Button
                  type="submit"
                  state={createExam.state}
                  icon={<PlusIcon />}
                  variant="secondary"
                  className="self-end"
                >
                  Set test
                </Button>
              </form>
            )}
            <ul className="mt-4 space-y-2">
              {exams.map((e) => (
                <li key={e.id} className="rounded-lg border border-mist px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{e.title}</p>
                      <p className="text-[11px] text-oat">
                        {e.subject} · {e.className} · {e.questionCount} questions ·{' '}
                        {e.durationMinutes} min · {e.attempts} sat
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-[10px] uppercase tracking-wider font-medium ${
                          e.status === 'OPEN'
                            ? 'text-leaf'
                            : e.status === 'CLOSED'
                              ? 'text-oat'
                              : 'text-gold'
                        }`}
                      >
                        {e.status.toLowerCase()}
                      </span>
                      {e.status !== 'OPEN' && (
                        <button
                          onClick={() => setStatus(e, 'OPEN')}
                          className="text-[12px] text-leaf hover:underline underline-offset-2"
                        >
                          Open
                        </button>
                      )}
                      {e.status === 'OPEN' && (
                        <button
                          onClick={() => setStatus(e, 'CLOSED')}
                          className="text-[12px] text-clay hover:underline underline-offset-2"
                        >
                          Close
                        </button>
                      )}
                      <button
                        onClick={() => openResults(e.id)}
                        className="text-[12px] text-brand hover:underline underline-offset-2"
                      >
                        Results
                      </button>
                    </div>
                  </div>
                </li>
              ))}
              {exams.length === 0 && <li className="text-sm text-oat">No tests set yet.</li>}
            </ul>
          </section>

          {results && (
            <section className="card p-6 rise rise-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-xl">{results.title}</h2>
                <Button
                  onClick={postMarks.run}
                  state={postMarks.state}
                  size="sm"
                  variant="secondary"
                  pendingLabel="Posting…"
                  doneLabel="Posted!"
                  failedLabel="Couldn't post"
                >
                  Post to gradebook
                </Button>
              </div>
              <p className="text-sm text-oat mt-1">
                {results.attempts.filter((a) => a.submittedAt).length} of {results.classSize}{' '}
                submitted.
              </p>
              <ul className="mt-3 space-y-1.5">
                {results.attempts.map((a) => (
                  <li
                    key={a.studentId}
                    className="flex justify-between text-sm border-b border-mist/50 last:border-0 pb-1.5 last:pb-0"
                  >
                    <span>
                      {a.name} <span className="text-[11px] text-oat tabular">{a.admissionNo}</span>
                    </span>
                    <span className="tabular font-medium">
                      {a.submittedAt ? `${a.score}/${a.total}` : 'not submitted'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-danger mt-4">{error}</p>}
    </div>
  );
}
