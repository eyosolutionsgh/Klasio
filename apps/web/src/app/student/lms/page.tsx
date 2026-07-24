'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PortalBrandHeader from '@/components/PortalBrandHeader';
import { Button, useAsyncAction } from '@/components/Button';

/**
 * The pupil's side of the LMS: lesson notes for their class, and assignments to hand in from home.
 * Work can be resubmitted until a teacher marks it, after which the mark and any feedback show
 * here. Everything is scoped to the signed-in pupil's class by the API.
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
  instructions: string;
  dueAt: string;
  points: number;
  overdue: boolean;
  submission: {
    text: string;
    submittedAt: string;
    score: number | null;
    feedback: string | null;
  } | null;
}
interface Data {
  lessons: Lesson[];
  assignments: Assignment[];
}

const area =
  'w-full rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/15';
const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });

export default function StudentLmsPage() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [school, setSchool] = useState<{ name: string } | null>(null);

  const load = useCallback(async () => {
    const meRes = await fetch('/api/student/student/me');
    if (meRes.status === 401) {
      router.push('/student/login');
      return;
    }
    if (meRes.ok) setSchool((await meRes.json()).school);
    const res = await fetch('/api/student/student/lms');
    setData(res.ok ? await res.json() : { lessons: [], assignments: [] });
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-dvh bg-parchment/30">
      <PortalBrandHeader schoolName={school?.name ?? 'Klasio'} subtitle="Lessons & assignments" />
      <div className="max-w-3xl mx-auto px-5 py-6 space-y-6">
        <a href="/student" className="text-sm text-forest underline underline-offset-2">
          ← Back
        </a>

        <section className="card p-6">
          <h1 className="font-display text-2xl">Assignments</h1>
          <div className="mt-4 space-y-4">
            {(data?.assignments ?? []).map((a) => (
              <AssignmentCard key={a.id} a={a} onSubmitted={load} />
            ))}
            {data && data.assignments.length === 0 && (
              <p className="text-sm text-oat">No assignments set for your class yet.</p>
            )}
          </div>
        </section>

        <section className="card p-6">
          <h2 className="font-display text-2xl">Lesson notes</h2>
          <div className="mt-4 space-y-4">
            {(data?.lessons ?? []).map((l) => (
              <article key={l.id} className="border-b border-mist/50 pb-4 last:border-0 last:pb-0">
                <h3 className="font-medium">{l.title}</h3>
                <p className="text-[12px] text-oat">
                  {l.subject} · {fmt(l.createdAt)}
                </p>
                <p className="mt-1 text-sm whitespace-pre-wrap text-ink/80">{l.content}</p>
              </article>
            ))}
            {data && data.lessons.length === 0 && (
              <p className="text-sm text-oat">No lesson notes yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function AssignmentCard({ a, onSubmitted }: { a: Assignment; onSubmitted: () => void }) {
  const [text, setText] = useState(a.submission?.text ?? '');
  const [error, setError] = useState<string | null>(null);
  const graded = a.submission?.score != null;

  const submit = useAsyncAction(async () => {
    setError(null);
    const res = await fetch(`/api/student/student/lms/assignments/${a.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.message ?? 'Could not submit.');
      throw new Error('rejected');
    }
    onSubmitted();
  });

  return (
    <article className="border-b border-mist/50 pb-4 last:border-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{a.title}</h3>
          <p className="text-[12px] text-oat">
            {a.subject} · due {fmt(a.dueAt)} · {a.points} marks
          </p>
        </div>
        {graded ? (
          <span className="text-sm font-medium text-forest tabular">
            {a.submission!.score}/{a.points}
          </span>
        ) : a.submission ? (
          <span className="text-[12px] text-oat">Submitted</span>
        ) : a.overdue ? (
          <span className="text-[12px] text-clay">Closed</span>
        ) : null}
      </div>
      <p className="mt-1 text-sm whitespace-pre-wrap text-ink/80">{a.instructions}</p>

      {graded ? (
        <div className="mt-2 rounded-lg bg-parchment/50 p-3 text-sm">
          <p className="whitespace-pre-wrap text-ink/80">{a.submission!.text}</p>
          {a.submission!.feedback && (
            <p className="mt-2 text-[13px] text-oat">Feedback: {a.submission!.feedback}</p>
          )}
        </div>
      ) : (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit.run();
          }}
        >
          <textarea
            className={area}
            rows={3}
            placeholder="Type your answer…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {error && <p className="text-[12px] text-clay">{error}</p>}
          <Button size="sm" variant="accent" state={submit.state} disabled={!text.trim()}>
            {a.submission ? 'Resubmit' : 'Submit'}
          </Button>
        </form>
      )}
    </article>
  );
}
