'use client';

import { useCallback, useEffect, useState } from 'react';

interface Component {
  id: string;
  name: string;
  maxScore: number;
  isExam: boolean;
  order: number;
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

const field =
  'rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

export default function AssessmentSettingsPage() {
  const [components, setComponents] = useState<Component[]>([]);
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [maxScore, setMaxScore] = useState('20');
  const [isExam, setIsExam] = useState(false);

  const load = useCallback(async () => {
    const [c, s, st] = await Promise.all([
      fetch('/api/proxy/assessment/components').then((r) => r.json()),
      fetch('/api/proxy/assessment/schemes').then((r) => r.json()),
      fetch('/api/proxy/school/structure').then((r) => r.json()),
    ]);
    setComponents(Array.isArray(c) ? c : []);
    setSchemes(Array.isArray(s) ? s : []);
    setLevels(st.levels ?? []);
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

  const sbaTotal = components.filter((c) => !c.isExam).reduce((a, c) => a + c.maxScore, 0);

  return (
    <div className="space-y-8">
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Assessment setup</h1>
        <p className="text-sm text-oat mt-1.5">
          Continuous-assessment components and grading schemes. SBA is scaled to 30 and the exam to
          70 on terminal reports.
        </p>
        {message && <p className="text-sm text-danger mt-2">{message}</p>}
      </div>

      <section className="card p-6 rise rise-2">
        <h2 className="font-display text-xl">SBA components</h2>
        <p className="text-xs text-oat mt-1">
          Continuous assessment totals {sbaTotal} marks and is scaled to 30. Exactly one component
          may be the end-of-term exam.
        </p>
        <table className="w-full text-sm mt-4">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist">
              <th className="py-2 font-medium">Component</th>
              <th className="py-2 font-medium text-right">Max score</th>
              <th className="py-2 font-medium">Type</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {components.map((c) => (
              <tr key={c.id} className="border-b border-mist/50 last:border-0">
                <td className="py-2.5 font-medium">{c.name}</td>
                <td className="py-2.5 text-right tabular">{c.maxScore}</td>
                <td className="py-2.5">
                  {c.isExam ? (
                    <span className="text-[10px] uppercase tracking-wider bg-gold-soft text-ink rounded-full px-2 py-0.5">
                      Exam
                    </span>
                  ) : (
                    <span className="text-oat text-xs">Continuous</span>
                  )}
                </td>
                <td className="py-2.5 text-right">
                  <button
                    onClick={() => send(`assessment/components/${c.id}`, undefined, 'DELETE')}
                    className="text-[12px] text-clay hover:underline"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form
          className="flex flex-wrap items-end gap-2 mt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await send('assessment/components', {
                name,
                maxScore: Number(maxScore),
                isExam,
              })
            ) {
              setName('');
              setIsExam(false);
            }
          }}
        >
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Class Test 3"
            className={`${field} w-48`}
          />
          <input
            required
            type="number"
            min="1"
            max="100"
            value={maxScore}
            onChange={(e) => setMaxScore(e.target.value)}
            className={`${field} w-24 tabular`}
          />
          <label className="flex items-center gap-2 text-[13px] pb-2">
            <input type="checkbox" checked={isExam} onChange={(e) => setIsExam(e.target.checked)} />
            End-of-term exam
          </label>
          <button className="rounded-lg bg-brand text-paper text-sm font-medium px-4 py-2 hover:bg-brand-deep transition">
            Add component
          </button>
        </form>
      </section>

      <section className="card p-6 rise rise-3">
        <h2 className="font-display text-xl">Grading schemes</h2>
        <p className="text-xs text-oat mt-1">
          Bands must cover 0–100 with no gaps or overlaps, so every possible score has exactly one
          grade.
        </p>
        <div className="mt-4 space-y-4">
          {schemes.map((s) => (
            <div key={s.id} className="border-t border-mist/60 pt-3 first:border-0">
              <p className="font-medium text-sm">
                {s.name}{' '}
                <span className="text-oat text-xs">{s.kind.toLowerCase().replace('_', ' ')}</span>
              </p>
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
                Used by:{' '}
                {levels
                  .filter((l) => l.gradingSchemeId === s.id)
                  .map((l) => l.name)
                  .join(', ') || 'no levels yet'}
              </p>
            </div>
          ))}
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
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
            if (ok) (e.target as HTMLFormElement).reset();
          }}
          className="mt-5 pt-5 border-t border-mist/60 space-y-3"
        >
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
          <button className="min-h-11 rounded-lg bg-brand text-paper text-sm font-medium px-4 hover:bg-brand-deep transition">
            Add scheme
          </button>
        </form>
      </section>

      <section className="card p-6 rise rise-4">
        <h2 className="font-display text-xl">Which scheme each level uses</h2>
        <ul className="mt-4 space-y-2">
          {levels.map((l) => (
            <li key={l.id} className="flex items-center gap-3 text-sm">
              <span className="w-32">{l.name}</span>
              <select
                value={l.gradingSchemeId ?? ''}
                onChange={(e) =>
                  send(`school/levels/${l.id}`, { gradingSchemeId: e.target.value }, 'PATCH')
                }
                className={field}
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
