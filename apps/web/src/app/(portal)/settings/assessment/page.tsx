'use client';

import { useCallback, useEffect, useState } from 'react';
import SchemeActions from '@/components/SchemeActions';
import { Button, useAsyncAction } from '@/components/Button';
import { PlusIcon, SaveIcon, TrashIcon } from '@/components/icons';

interface Component {
  id: string;
  name: string;
  maxScore: number;
  category: 'CONTINUOUS' | 'EXAM';
  subjectId: string | null;
  levelId: string | null;
  order: number;
}
interface Named {
  id: string;
  name: string;
}
interface Band {
  min: number;
  max: number;
  grade: string;
  remark: string;
}
interface Scheme {
  id: string;
  name: string;
  kind: string;
  bands: Band[];
}
interface Level {
  id: string;
  name: string;
  gradingSchemeId: string | null;
}
interface Weights {
  sbaWeight: number;
  examWeight: number;
}

const field =
  'rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

export default function AssessmentSettingsPage() {
  const [components, setComponents] = useState<Component[]>([]);
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [subjects, setSubjects] = useState<Named[]>([]);
  const [weights, setWeights] = useState<Weights>({ sbaWeight: 30, examWeight: 70 });
  const [message, setMessage] = useState<string | null>(null);
  const [held, setHeld] = useState<string[]>([]);

  // Changing or removing a scheme is `assessment.configure` on the API. Offering the controls to
  // anyone else would only produce a 403 that reads as the portal breaking.
  const canConfigure = held.includes('assessment.configure');

  const [name, setName] = useState('');
  const [maxScore, setMaxScore] = useState('20');
  const [category, setCategory] = useState<'CONTINUOUS' | 'EXAM'>('CONTINUOUS');
  const [subjectId, setSubjectId] = useState('');
  const [levelId, setLevelId] = useState('');

  const load = useCallback(async () => {
    const [c, s, st, w, me] = await Promise.all([
      fetch('/api/proxy/assessment/components').then((r) => r.json()),
      fetch('/api/proxy/assessment/schemes').then((r) => r.json()),
      fetch('/api/proxy/school/structure').then((r) => r.json()),
      fetch('/api/proxy/assessment/weights').then((r) => r.json()),
      fetch('/api/proxy/me').then((r) => r.json()),
    ]);
    setComponents(Array.isArray(c) ? c : []);
    setSchemes(Array.isArray(s) ? s : []);
    setLevels(st.levels ?? []);
    setSubjects(st.subjects ?? []);
    if (typeof w?.sbaWeight === 'number') setWeights(w);
    setHeld(me?.permissions ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function send(path: string, body?: unknown, method = 'POST') {
    setMessage(null);
    const res = await fetch(`/api/proxy/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(data.message ?? 'That did not work.');
      return false;
    }
    load();
    return true;
  }

  // Each form drives its own button. `send` reports a refusal by returning false, so the action
  // has to throw on it — otherwise the button would show a tick for a save the API rejected.
  const saveWeights = useAsyncAction(async () => {
    if (!(await send('assessment/weights', weights, 'PATCH'))) throw new Error('rejected');
  });

  const addComponent = useAsyncAction(async () => {
    const ok = await send('assessment/components', {
      name,
      maxScore: Number(maxScore),
      category,
      // Omitted rather than sent empty — the API reads absent as "applies everywhere".
      ...(subjectId ? { subjectId } : {}),
      ...(levelId ? { levelId } : {}),
    });
    if (!ok) throw new Error('rejected');
    setName('');
    setCategory('CONTINUOUS');
    setSubjectId('');
    setLevelId('');
  });

  const addScheme = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    // Held onto before the first await — `currentTarget` is gone by the time the request settles.
    const form = e.currentTarget;
    const f = new FormData(form);
    // "0-44:F, 45-49:E" — far quicker to type than a row-builder, and the server
    // still refuses anything that does not cover 0-100 exactly once.
    const bands = String(f.get('bands') ?? '')
      .split(',')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const [range, grade] = chunk.split(':').map((x) => x.trim());
        const [min, max] = (range ?? '').split('-').map((x) => Number(x.trim()));
        return { min, max, grade: grade ?? '' };
      });
    const ok = await send('assessment/schemes', {
      name: String(f.get('name') ?? '').trim(),
      kind: String(f.get('kind') ?? 'GES_CLASSIC'),
      bands,
    });
    if (!ok) throw new Error('rejected');
    form.reset();
  });

  const scopeLabel = (c: Component) => {
    const parts = [
      c.subjectId ? (subjects.find((x) => x.id === c.subjectId)?.name ?? 'one subject') : null,
      c.levelId ? (levels.find((x) => x.id === c.levelId)?.name ?? 'one level') : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Every subject and level';
  };

  return (
    <div className="space-y-8">
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Assessment setup</h1>
        <p className="text-sm text-oat mt-1.5">
          The assessments your school runs, how the two sides are weighted, and the grading schemes
          that turn a total into a grade.
        </p>
        {message && <p className="text-sm text-danger mt-2">{message}</p>}
      </div>

      <section className="card p-6 rise rise-2">
        <h2 className="font-display text-xl">Weighting</h2>
        <p className="text-xs text-oat mt-1">
          How much of the final mark comes from continuous work and how much from the exam. GES uses
          30 and 70. The two must add up to 100.
        </p>
        <form className="flex flex-wrap items-end gap-3 mt-4" onSubmit={saveWeights.run}>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Continuous assessment</span>
            <input
              type="number"
              min="0"
              max="100"
              value={weights.sbaWeight}
              onChange={(e) => {
                // The pair always sums to 100, so moving one moves the other. Typing both
                // independently only ever produces a rejected save.
                const sba = Math.max(0, Math.min(100, Number(e.target.value)));
                setWeights({ sbaWeight: sba, examWeight: 100 - sba });
              }}
              className={`${field} w-24 tabular`}
            />
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Exam</span>
            <input
              readOnly
              value={weights.examWeight}
              className={`${field} w-24 tabular bg-parchment text-oat`}
            />
          </label>
          <Button type="submit" state={saveWeights.state} icon={<SaveIcon />}>
            Save weighting
          </Button>
        </form>
        <p className="text-[11px] text-oat mt-3">
          Changing this re-scales every report generated afterwards. Reports already generated keep
          the weighting they were built with until they are regenerated.
        </p>
      </section>

      <section className="card p-6 rise rise-3">
        <h2 className="font-display text-xl">Assessments</h2>
        <p className="text-xs text-oat mt-1">
          Add as many as you run. Each side is scored as a proportion of what has actually been
          marked, so a part-marked term still reads sensibly — you do not need to add them all up
          front, and there is no limit on how many exams or tests you keep.
        </p>
        {/*
          Not paged. A school's assessments are bounded config — a handful per subject, all of them
          read together when deciding what the term is made of — and a pager over six rows would be
          chrome pretending there is more to find. The floor only applies where this is still a
          table; below `sm` each assessment is its own card.
        */}
        <div className="mt-4 overflow-x-auto table-stack-wrap">
          <table className="w-full text-sm sm:min-w-[520px] table-stack">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist">
                <th className="py-2 font-medium">Assessment</th>
                <th className="py-2 pr-6 font-medium text-right">Out of</th>
                <th className="py-2 pr-6 font-medium">Counts as</th>
                <th className="py-2 font-medium">Applies to</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {components.map((c) => (
                <tr key={c.id} className="border-b border-mist/50 last:border-0">
                  <td data-label="Assessment" className="py-2.5 font-medium">
                    {c.name}
                  </td>
                  <td data-label="Out of" className="py-2.5 pr-6 text-right tabular">
                    {c.maxScore}
                  </td>
                  <td data-label="Counts as" className="py-2.5 pr-6">
                    {c.category === 'EXAM' ? (
                      <span className="text-[10px] uppercase tracking-wider bg-gold-soft text-ink rounded-full px-2 py-0.5">
                        Exam
                      </span>
                    ) : (
                      <span className="text-oat text-xs">Continuous</span>
                    )}
                  </td>
                  <td data-label="Applies to" className="py-2.5 pr-6 text-xs text-oat">
                    {scopeLabel(c)}
                  </td>
                  {/* No data-label: an actions cell labelled "Remove: Remove" reads as a stutter. */}
                  <td className="py-2.5 text-right">
                    <RemoveComponentButton
                      onRemove={async () => {
                        if (!(await send(`assessment/components/${c.id}`, undefined, 'DELETE')))
                          throw new Error('rejected');
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="flex flex-wrap items-end gap-2 mt-4 pt-4 border-t border-mist/60"
          onSubmit={addComponent.run}
        >
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Class Test 3"
              className={`${field} w-44`}
            />
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Out of</span>
            <input
              required
              type="number"
              min="1"
              max="100"
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
              className={`${field} w-20 tabular`}
            />
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Counts as</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as 'CONTINUOUS' | 'EXAM')}
              className={field}
            >
              <option value="CONTINUOUS">Continuous assessment</option>
              <option value="EXAM">Exam</option>
            </select>
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Subject</span>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className={field}
            >
              <option value="">Every subject</option>
              {subjects.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Level</span>
            <select value={levelId} onChange={(e) => setLevelId(e.target.value)} className={field}>
              <option value="">Every level</option>
              {levels.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" state={addComponent.state} icon={<PlusIcon />}>
            Add assessment
          </Button>
        </form>
      </section>

      <section className="card p-6 rise rise-4">
        <h2 className="font-display text-xl">Grading schemes</h2>
        <p className="text-xs text-oat mt-1">
          Bands must cover 0–100 with no gaps or overlaps, so every possible score has exactly one
          grade.
        </p>
        <div className="mt-4 space-y-4">
          {schemes.map((s) => {
            const usedBy = levels.filter((l) => l.gradingSchemeId === s.id).map((l) => l.name);
            return (
              <div key={s.id} className="border-t border-mist/60 pt-3 first:border-0">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-sm">
                    {s.name}{' '}
                    <span className="text-oat text-xs">
                      {s.kind.toLowerCase().replace('_', ' ')}
                    </span>
                  </p>
                  {canConfigure && <SchemeActions scheme={s} usedBy={usedBy} onDone={load} />}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {(s.bands ?? []).map((b, i) => (
                    <span
                      key={i}
                      className="text-[11px] rounded-full border border-mist px-2 py-0.5 tabular"
                    >
                      {b.min}–{b.max}: <span className="font-medium">{b.grade}</span>
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-oat mt-2">
                  Used by: {usedBy.join(', ') || 'no levels yet'}
                </p>
              </div>
            );
          })}
        </div>

        <form onSubmit={addScheme.run} className="mt-5 pt-5 border-t border-mist/60 space-y-3">
          <h3 className="font-medium text-sm">Add a scheme</h3>
          <div className="flex flex-wrap gap-2">
            <input name="name" required minLength={2} placeholder="Scheme name" className={field} />
            <select name="kind" defaultValue="GES_CLASSIC" className={field}>
              <option value="GES_CLASSIC">GES classic</option>
              <option value="NACCA_BANDS">NaCCA proficiency bands</option>
              <option value="EARLY_YEARS">Early-years observation</option>
            </select>
          </div>
          <label className="block text-[13px]">
            <span className="block text-oat mb-1">Bands — min-max:grade, comma separated</span>
            <input
              name="bands"
              required
              placeholder="0-44:F, 45-49:E, 50-54:D, 55-64:C, 65-74:B, 75-100:A"
              className={`${field} w-full`}
            />
          </label>
          <Button type="submit" state={addScheme.state} icon={<PlusIcon />}>
            Add scheme
          </Button>
        </form>
      </section>

      <section className="card p-6 rise rise-5">
        <h2 className="font-display text-xl">Which scheme each level uses</h2>
        <ul className="mt-4 space-y-2">
          {levels.map((l) => (
            // Wraps rather than squeezing: a fixed 8rem label beside a select left the dropdown
            // about two characters wide on a handset, so no scheme name was readable.
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="w-32 shrink-0">{l.name}</span>
              <select
                value={l.gradingSchemeId ?? ''}
                onChange={(e) =>
                  send(`school/levels/${l.id}`, { gradingSchemeId: e.target.value }, 'PATCH')
                }
                className={`${field} min-w-0 flex-1`}
              >
                <option value="">— default (GES) —</option>
                {schemes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * One action per row: a hook cannot be called inside the map, and a shared pending state would
 * spin every row's button whenever any one of them was removing.
 */
function RemoveComponentButton({ onRemove }: { onRemove: () => Promise<void> }) {
  const action = useAsyncAction(onRemove);
  return (
    <Button
      onClick={action.run}
      state={action.state}
      variant="ghost"
      size="sm"
      icon={<TrashIcon />}
    >
      Remove
    </Button>
  );
}
