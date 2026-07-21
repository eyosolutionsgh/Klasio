'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Combobox from './Combobox';
import { Button, useAsyncAction } from './Button';
import { PlusIcon } from './icons';

interface Topic {
  id: string;
  title: string;
  order: number;
  covered?: boolean;
}
interface SummaryRow {
  classId: string;
  className: string;
  topics: number;
  covered: number;
  pct: number;
}
interface Props {
  subjects: { id: string; name: string }[];
  levels: { id: string; name: string }[];
  classes: { id: string; name: string; levelId: string }[];
  canConfigure: boolean;
  canTick: boolean;
}

/**
 * The scheme of work as a tick-list. Topics belong to a subject at a level; the ticks belong to
 * one class working through them. The summary answers the head's question — which classes are
 * behind — without opening each class in turn.
 */
export default function SyllabusBoard({ subjects, levels, classes, canConfigure, canTick }: Props) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? '');
  const [levelId, setLevelId] = useState(levels[0]?.id ?? '');
  const [classId, setClassId] = useState('');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const levelClasses = useMemo(
    () => classes.filter((c) => c.levelId === levelId),
    [classes, levelId],
  );

  // A class from another level cannot stay selected when the level changes.
  useEffect(() => {
    if (classId && !levelClasses.some((c) => c.id === classId)) setClassId('');
  }, [levelClasses, classId]);

  const load = useCallback(async () => {
    if (!subjectId || !levelId) return;
    const qs = `subjectId=${subjectId}&levelId=${levelId}${classId ? `&classId=${classId}` : ''}`;
    const [t, s] = await Promise.all([
      fetch(`/api/proxy/syllabus/topics?${qs}`).then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/proxy/syllabus/summary?subjectId=${subjectId}`).then((r) =>
        r.ok ? r.json() : [],
      ),
    ]);
    setTopics(t);
    setSummary(s);
  }, [subjectId, levelId, classId]);

  useEffect(() => {
    load();
  }, [load]);

  const addTopic = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    const f = new FormData(form);
    setError(null);
    const res = await fetch('/api/proxy/syllabus/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectId, levelId, title: String(f.get('title') ?? '') }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? 'Could not add that topic.');
      throw new Error('rejected');
    }
    form.reset();
    load();
  });

  async function tick(topic: Topic) {
    if (!classId) return;
    setBusy(topic.id);
    const res = await fetch(`/api/proxy/syllabus/topics/${topic.id}/coverage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId, covered: !topic.covered }),
    });
    setBusy(null);
    if (res.ok) load();
  }

  async function removeTopic(topic: Topic) {
    if (!confirm(`Remove "${topic.title}" from the syllabus? Class ticks against it go too.`))
      return;
    const res = await fetch(`/api/proxy/syllabus/topics/${topic.id}`, { method: 'DELETE' });
    if (res.ok) load();
  }

  return (
    <div className="grid lg:grid-cols-[1.3fr_1fr] gap-6">
      <section className="card p-6 rise rise-2">
        <div className="flex flex-wrap gap-3">
          <Combobox
            label="Subject"
            className="w-44"
            allowClear={false}
            options={subjects.map((s) => ({ value: s.id, label: s.name }))}
            value={subjectId}
            onChange={setSubjectId}
          />
          <Combobox
            label="Level"
            className="w-36"
            allowClear={false}
            options={levels.map((l) => ({ value: l.id, label: l.name }))}
            value={levelId}
            onChange={setLevelId}
          />
          <Combobox
            label="Class"
            className="w-36"
            clearLabel="No class"
            placeholder="Tick for…"
            options={levelClasses.map((c) => ({ value: c.id, label: c.name }))}
            value={classId}
            onChange={setClassId}
          />
        </div>

        {canConfigure && (
          <form onSubmit={addTopic.run} className="mt-4 flex flex-wrap gap-2">
            <input
              name="title"
              required
              minLength={2}
              placeholder="Add a topic, e.g. Fractions — addition and subtraction"
              className="flex-1 min-w-[14rem] min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
            <Button type="submit" state={addTopic.state} icon={<PlusIcon />}>
              Add topic
            </Button>
          </form>
        )}
        {error && <p className="text-sm text-danger mt-2">{error}</p>}

        <ul className="mt-4 space-y-1.5">
          {topics.map((t, i) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-mist/60 px-3 py-2"
            >
              <label className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer">
                {classId && (
                  <input
                    type="checkbox"
                    checked={!!t.covered}
                    disabled={!canTick || busy === t.id}
                    onChange={() => tick(t)}
                    className="size-4 accent-[var(--brand,#0d7a70)]"
                  />
                )}
                <span
                  className={`text-sm truncate ${t.covered && classId ? 'text-oat line-through decoration-mist' : ''}`}
                >
                  <span className="text-oat tabular mr-2">{i + 1}.</span>
                  {t.title}
                </span>
              </label>
              {canConfigure && (
                <button
                  onClick={() => removeTopic(t)}
                  className="text-[12px] text-clay hover:underline underline-offset-2 shrink-0"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
          {topics.length === 0 && (
            <li className="text-sm text-oat py-4">
              No topics yet for this subject at this level.
              {canConfigure ? ' Add the scheme of work above.' : ''}
            </li>
          )}
        </ul>
        {!classId && topics.length > 0 && (
          <p className="text-[12px] text-oat mt-3">Pick a class to tick topics off for it.</p>
        )}
      </section>

      <section className="card p-6 rise rise-3">
        <h2 className="font-display text-xl">Where each class stands</h2>
        <p className="text-sm text-oat mt-1.5">Across every level teaching this subject.</p>
        <ul className="mt-4 space-y-3">
          {summary.map((s) => (
            <li key={s.classId}>
              <div className="flex justify-between text-sm">
                <span className="font-medium">{s.className}</span>
                <span className="tabular text-oat">
                  {s.covered}/{s.topics} · {s.pct}%
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-parchment overflow-hidden">
                <div
                  className={`h-full rounded-full ${s.pct >= 75 ? 'bg-leaf' : s.pct >= 40 ? 'bg-gold' : 'bg-clay'}`}
                  style={{ width: `${s.pct}%` }}
                />
              </div>
            </li>
          ))}
          {summary.length === 0 && (
            <li className="text-sm text-oat">Nothing to show until topics exist.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
