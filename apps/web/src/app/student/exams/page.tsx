'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useAsyncAction } from '@/components/Button';

interface ExamRow {
  id: string;
  title: string;
  subject: string;
  durationMinutes: number;
  questionCount: number;
  status: string;
  attempt: { submittedAt: string | null; score: number | null; total: number | null } | null;
}
interface Sitting {
  attemptId: string;
  title: string;
  endsAt: string;
  questions: { id: string; text: string; options: string[] }[];
}

/**
 * The pupil's test screen: a visible clock, one radio group per question, one submit. The
 * timer runs from the FIRST start, so closing the page does not buy more time, and scores show
 * only once the teacher closes the test — everyone hears together.
 */
export default function StudentExamsPage() {
  const router = useRouter();
  const [exams, setExams] = useState<ExamRow[] | null>(null);
  const [sitting, setSitting] = useState<Sitting | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/student/student/cbt');
    if (res.status === 401) {
      router.push('/student/login');
      return;
    }
    setExams(res.ok ? await res.json() : []);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!sitting) return;
    const tick = () => {
      const left = Math.max(
        0,
        Math.floor((new Date(sitting.endsAt).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(left);
    };
    tick();
    timer.current = setInterval(tick, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [sitting]);

  const start = useAsyncAction(async (id: string) => {
    setError(null);
    const res = await fetch(`/api/student/student/cbt/${id}/start`, { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.message ?? 'Could not start.');
      throw new Error('rejected');
    }
    setSitting({ ...d, examId: id } as Sitting & { examId: string });
    setAnswers({});
    setDone(null);
  });

  const submit = useAsyncAction(async () => {
    if (!sitting) return;
    const examId = (sitting as Sitting & { examId?: string }).examId;
    setError(null);
    const res = await fetch(`/api/student/student/cbt/${examId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.message ?? 'Could not submit.');
      throw new Error('rejected');
    }
    setDone('Submitted! Your score appears here once the teacher closes the test.');
    setSitting(null);
    load();
  });

  const clock = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  if (sitting) {
    const answered = Object.keys(answers).length;
    return (
      <main className="min-h-dvh max-w-2xl mx-auto px-5 py-6">
        <div className="sticky top-0 bg-paper/95 backdrop-blur border-b border-mist py-3 flex items-center justify-between gap-3 z-10">
          <h1 className="font-display text-xl truncate">{sitting.title}</h1>
          <span
            className={`font-display text-2xl tabular shrink-0 ${secondsLeft < 120 ? 'text-danger' : ''}`}
            aria-live="polite"
          >
            {clock}
          </span>
        </div>
        <ol className="mt-5 space-y-6">
          {sitting.questions.map((q, qi) => (
            <li key={q.id}>
              <p className="text-sm font-medium">
                <span className="text-oat tabular mr-2">{qi + 1}.</span>
                {q.text}
              </p>
              <div role="radiogroup" aria-label={`Question ${qi + 1}`} className="mt-2 space-y-1.5">
                {q.options.map((opt, oi) => (
                  <label
                    key={oi}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm cursor-pointer transition ${
                      answers[q.id] === oi ? 'border-forest bg-forest-mist/50' : 'border-mist'
                    }`}
                  >
                    <input
                      type="radio"
                      name={q.id}
                      checked={answers[q.id] === oi}
                      onChange={() => setAnswers({ ...answers, [q.id]: oi })}
                      className="size-4 accent-[#002b5b]"
                    />
                    <span>
                      <span className="text-oat mr-1.5">{String.fromCharCode(65 + oi)}.</span>
                      {opt}
                    </span>
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ol>
        <div className="sticky bottom-0 bg-paper/95 backdrop-blur border-t border-mist py-3 mt-6 flex items-center justify-between gap-3">
          <span className="text-[12px] text-oat tabular">
            {answered}/{sitting.questions.length} answered
          </span>
          <Button
            onClick={submit.run}
            state={submit.state}
            pendingLabel="Submitting…"
            doneLabel="Submitted!"
            failedLabel="Couldn't submit"
            className="bg-forest! text-paper hover:bg-forest-deep!"
          >
            Submit my answers
          </Button>
        </div>
        {error && <p className="text-sm text-danger mt-2">{error}</p>}
      </main>
    );
  }

  return (
    <main className="min-h-dvh max-w-2xl mx-auto px-5 py-6">
      <a
        href="/student"
        className="text-[13px] text-oat hover:text-forest underline underline-offset-2"
      >
        ← Back to my page
      </a>
      <h1 className="font-display text-3xl mt-3">My tests</h1>
      {done && (
        <p className="text-sm text-leaf bg-leaf/10 border border-leaf/20 rounded-lg px-3 py-2 mt-3">
          {done}
        </p>
      )}
      <ul className="mt-5 space-y-3">
        {(exams ?? []).map((e) => (
          <li key={e.id} className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-sm">{e.title}</p>
                <p className="text-[11px] text-oat">
                  {e.subject} · {e.questionCount} questions · {e.durationMinutes} minutes
                </p>
              </div>
              {e.attempt?.submittedAt ? (
                e.status === 'CLOSED' ? (
                  <span className="font-display text-xl tabular">
                    {e.attempt.score}/{e.attempt.total}
                  </span>
                ) : (
                  <span className="text-[12px] text-leaf font-medium">
                    Submitted — score comes when it closes
                  </span>
                )
              ) : e.status === 'OPEN' ? (
                <Button
                  onClick={() => start.run(e.id)}
                  state={start.state}
                  pendingLabel="Starting…"
                  className="bg-forest! text-paper hover:bg-forest-deep!"
                >
                  Start
                </Button>
              ) : (
                <span className="text-[12px] text-oat">closed</span>
              )}
            </div>
          </li>
        ))}
        {exams !== null && exams.length === 0 && (
          <li className="text-sm text-oat">No tests for your class right now.</li>
        )}
      </ul>
      {error && <p className="text-sm text-danger mt-3">{error}</p>}
    </main>
  );
}
