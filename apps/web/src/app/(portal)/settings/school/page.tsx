'use client';

import { useCallback, useEffect, useState } from 'react';

interface Term {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  nextTermBegins: string | null;
  isCurrent: boolean;
}
interface Year {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  terms: Term[];
}
interface Level {
  id: string;
  name: string;
  category: string;
  order: number;
}
interface ClassRoom {
  id: string;
  name: string;
  level: string;
  levelId: string;
  studentCount: number;
}
interface Subject {
  id: string;
  name: string;
  code: string;
  isCore: boolean;
}

const fmt = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

const field =
  'rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

/**
 * A worked example of the admission number, so a school sees the shape before saving it.
 *
 * Deliberately mirrors `formatAdmissionNo` on the server rather than calling it: this runs on
 * every keystroke and a round trip per character would be absurd. The server remains the
 * authority — it validates and rejects — this only shows what is about to happen.
 */
function previewId(template: string, seq: number): string | null {
  const t = template.trim();
  if (!t) return null;
  const seqTokens = t.match(/\{(#+)\}/g) ?? [];
  if (seqTokens.length !== 1) return null;
  const unknown = (t.match(/\{([^}]*)\}/g) ?? []).filter(
    (tok) => !/^\{#+\}$/.test(tok) && !['{YYYY}', '{YY}', '{LEVEL}'].includes(tok),
  );
  if (unknown.length > 0) return null;
  const year = new Date().getFullYear();
  return t
    .replace(/\{YYYY\}/g, String(year))
    .replace(/\{YY\}/g, String(year % 100).padStart(2, '0'))
    .replace(/\{LEVEL\}/g, 'JHS')
    .replace(/\{(#+)\}/g, (_m, h: string) => String(seq).padStart(h.length, '0'))
    .replace(/([-/_])\1+/g, '$1')
    .replace(/^[-/_]+|[-/_]+$/g, '');
}

export default function SchoolSetupPage() {
  const [years, setYears] = useState<Year[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [template, setTemplate] = useState<'GES' | 'MODERN'>('GES');
  const [message, setMessage] = useState<string | null>(null);
  const [idFormat, setIdFormat] = useState('{YYYY}-{####}');
  const [idNext, setIdNext] = useState('1');
  const [idSaved, setIdSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [res, meRes] = await Promise.all([
      fetch('/api/proxy/school/structure'),
      fetch('/api/proxy/me'),
    ]);
    if (!res.ok) return;
    const s = await res.json();
    setYears(s.years ?? []);
    setLevels(s.levels ?? []);
    setClasses(s.classes ?? []);
    setSubjects(s.subjects ?? []);
    if (meRes.ok) {
      const me = await meRes.json();
      if (me.school?.reportTemplate) setTemplate(me.school.reportTemplate);
      if (me.school?.admissionNoFormat) setIdFormat(me.school.admissionNoFormat);
      if (me.school?.admissionNoNext) setIdNext(String(me.school.admissionNoNext));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function send(path: string, body?: unknown, method = 'POST') {
    setMessage(null);
    const res = await fetch(`/api/proxy/school/${path}`, {
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

  // ── forms ────────────────────────────────────────────────────────
  const [yearName, setYearName] = useState('');
  const [yearStart, setYearStart] = useState('');
  const [yearEnd, setYearEnd] = useState('');

  const [termYearId, setTermYearId] = useState('');
  const [termName, setTermName] = useState('');
  const [termStart, setTermStart] = useState('');
  const [termEnd, setTermEnd] = useState('');
  const [termNext, setTermNext] = useState('');

  const [levelName, setLevelName] = useState('');
  const [levelCat, setLevelCat] = useState('PRIMARY');

  const [className, setClassName] = useState('');
  const [classLevelId, setClassLevelId] = useState('');

  const [subjName, setSubjName] = useState('');
  const [subjCode, setSubjCode] = useState('');
  const [subjCore, setSubjCore] = useState(false);

  return (
    <div className="space-y-8">
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">School setup</h1>
        <p className="text-sm text-oat mt-1.5">
          The academic calendar and structure everything else hangs off — terms drive invoicing,
          attendance and reports.
        </p>
        {message && <p className="text-sm text-danger mt-2">{message}</p>}
      </div>

      {/* Report template */}
      <section className="card p-6 rise rise-2">
        <h2 className="font-display text-xl">Student ID numbers</h2>
        <p className="text-xs text-oat mt-1">
          How this school numbers its students. Whatever you already print on report cards and ID
          cards, put it here — you should not have to keep two sets of numbers.
        </p>

        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setIdSaved(null);
            const ok = await send(
              'settings',
              { admissionNoFormat: idFormat, admissionNoNext: Number(idNext) },
              'PATCH',
            );
            if (ok) setIdSaved('Saved. New students will be numbered this way.');
          }}
        >
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Format</span>
            <input
              value={idFormat}
              onChange={(e) => setIdFormat(e.target.value)}
              placeholder="BA-{YYYY}-{####}"
              className="w-56 min-h-11 rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Next number</span>
            <input
              type="number"
              min="1"
              value={idNext}
              onChange={(e) => setIdNext(e.target.value)}
              className="w-28 min-h-11 rounded-lg border border-mist bg-white px-3 py-2 text-sm tabular outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </label>
          <button className="min-h-11 rounded-lg bg-brand text-paper text-sm font-medium px-4 hover:bg-brand-deep transition">
            Save
          </button>
        </form>

        <div className="mt-4 rounded-lg bg-parchment/60 p-4">
          {previewId(idFormat, Number(idNext) || 1) ? (
            <p className="text-sm">
              The next student enrolled will be{' '}
              <span className="font-display text-lg">
                {previewId(idFormat, Number(idNext) || 1)}
              </span>
            </p>
          ) : (
            <p className="text-sm text-clay">
              That format will not work yet — it needs a number part like {'{####}'}, used once.
            </p>
          )}
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-[12px] text-oat sm:grid-cols-2">
            <div>
              <dt className="inline font-medium text-ink">{'{YYYY}'}</dt> — the year, in full
            </div>
            <div>
              <dt className="inline font-medium text-ink">{'{YY}'}</dt> — the year, two digits
            </div>
            <div>
              <dt className="inline font-medium text-ink">{'{####}'}</dt> — the number, padded to
              that many digits
            </div>
            <div>
              <dt className="inline font-medium text-ink">{'{LEVEL}'}</dt> — the level&rsquo;s short
              code, where you use one
            </div>
          </dl>
          <p className="text-[11px] text-oat mt-3">
            Anything else you type is kept exactly as it is. Changing the format never renumbers
            students already enrolled, and the next number cannot be set below one already issued.
          </p>
          {idSaved && <p className="text-sm text-leaf mt-2">{idSaved}</p>}
        </div>
      </section>

      <section className="card p-6 rise rise-2">
        <h2 className="font-display text-xl">Terminal report layout</h2>
        <p className="text-xs text-oat mt-1">
          GES keeps the familiar statutory look. Modern is a cleaner layout with a coloured masthead
          — the same marks, grades and remarks either way.
        </p>
        <div className="flex gap-2 mt-4">
          {(['GES', 'MODERN'] as const).map((t) => (
            <button
              key={t}
              onClick={async () => {
                if (await send('settings', { reportTemplate: t }, 'PATCH')) setTemplate(t);
              }}
              className={`text-[13px] rounded-full px-4 py-1.5 border transition ${
                template === t
                  ? 'bg-brand text-paper border-brand'
                  : 'border-mist bg-white hover:border-brand'
              }`}
            >
              {t === 'GES' ? 'GES classic' : 'Modern'}
            </button>
          ))}
        </div>
      </section>

      {/* Academic years & terms */}
      <section className="card p-6 rise rise-2">
        <h2 className="font-display text-xl">Academic years &amp; terms</h2>
        {years.map((y) => (
          <div key={y.id} className="mt-4 border-t border-mist/60 pt-3 first:border-0">
            <p className="font-medium">
              {y.name}
              {y.isCurrent && (
                <span className="ml-2 text-[10px] uppercase tracking-wider bg-brand-mist text-brand rounded-full px-2 py-0.5">
                  Current
                </span>
              )}
              <span className="text-oat font-normal text-xs ml-2">
                {fmt(y.startDate)} – {fmt(y.endDate)}
              </span>
            </p>
            <ul className="mt-2 space-y-1">
              {y.terms.map((t) => (
                <li key={t.id} className="flex items-center gap-3 text-sm">
                  <span className="w-24">{t.name}</span>
                  <span className="text-oat text-xs tabular">
                    {fmt(t.startDate)} – {fmt(t.endDate)} · next term {fmt(t.nextTermBegins)}
                  </span>
                  {t.isCurrent ? (
                    <span className="text-[10px] uppercase tracking-wider bg-gold-soft text-ink rounded-full px-2 py-0.5">
                      Current term
                    </span>
                  ) : (
                    <button
                      onClick={() => send(`terms/${t.id}/current`)}
                      className="text-[12px] text-brand hover:underline underline-offset-2"
                    >
                      Make current
                    </button>
                  )}
                </li>
              ))}
              {y.terms.length === 0 && <li className="text-xs text-oat">No terms yet.</li>}
            </ul>
          </div>
        ))}

        <div className="grid md:grid-cols-2 gap-6 mt-6 pt-5 border-t border-mist">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await send('years', { name: yearName, startDate: yearStart, endDate: yearEnd }))
                setYearName('');
            }}
          >
            <p className="text-[13px] font-medium mb-2">Add an academic year</p>
            <div className="space-y-2">
              <input
                required
                value={yearName}
                onChange={(e) => setYearName(e.target.value)}
                placeholder="2026/2027"
                className={`${field} w-full`}
              />
              <div className="flex gap-2">
                <input
                  required
                  type="date"
                  value={yearStart}
                  onChange={(e) => setYearStart(e.target.value)}
                  className={`${field} flex-1`}
                />
                <input
                  required
                  type="date"
                  value={yearEnd}
                  onChange={(e) => setYearEnd(e.target.value)}
                  className={`${field} flex-1`}
                />
              </div>
              <button className="rounded-lg bg-brand text-paper text-sm font-medium px-4 py-2 hover:bg-brand-deep transition">
                Add year
              </button>
            </div>
          </form>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await send(`years/${termYearId}/terms`, {
                  name: termName,
                  startDate: termStart,
                  endDate: termEnd,
                  nextTermBegins: termNext || undefined,
                })
              )
                setTermName('');
            }}
          >
            <p className="text-[13px] font-medium mb-2">Add a term</p>
            <div className="space-y-2">
              <select
                required
                value={termYearId}
                onChange={(e) => setTermYearId(e.target.value)}
                className={`${field} w-full`}
              >
                <option value="">— academic year —</option>
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
              </select>
              <input
                required
                value={termName}
                onChange={(e) => setTermName(e.target.value)}
                placeholder="Term 1"
                className={`${field} w-full`}
              />
              <div className="flex gap-2">
                <input
                  required
                  type="date"
                  value={termStart}
                  onChange={(e) => setTermStart(e.target.value)}
                  className={`${field} flex-1`}
                />
                <input
                  required
                  type="date"
                  value={termEnd}
                  onChange={(e) => setTermEnd(e.target.value)}
                  className={`${field} flex-1`}
                />
              </div>
              <label className="block text-[12px] text-oat">
                Next term begins (printed on report cards)
                <input
                  type="date"
                  value={termNext}
                  onChange={(e) => setTermNext(e.target.value)}
                  className={`${field} w-full mt-1`}
                />
              </label>
              <button className="rounded-lg bg-brand text-paper text-sm font-medium px-4 py-2 hover:bg-brand-deep transition">
                Add term
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Levels & classes */}
      <section className="card p-6 rise rise-3">
        <h2 className="font-display text-xl">Levels &amp; classes</h2>
        <div className="grid md:grid-cols-2 gap-6 mt-4">
          <div>
            <p className="text-[13px] font-medium mb-2">Levels</p>
            <ul className="space-y-1 text-sm">
              {levels.map((l) => (
                <li key={l.id} className="flex items-center justify-between">
                  <span>
                    {l.name}{' '}
                    <span className="text-oat text-xs">
                      {l.category.toLowerCase().replace('_', ' ')}
                    </span>
                  </span>
                  <button
                    onClick={() => send(`levels/${l.id}`, undefined, 'DELETE')}
                    className="text-[12px] text-clay hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="flex gap-2 mt-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await send('levels', {
                    name: levelName,
                    category: levelCat,
                    order: levels.length + 1,
                  })
                )
                  setLevelName('');
              }}
            >
              <input
                required
                value={levelName}
                onChange={(e) => setLevelName(e.target.value)}
                placeholder="Basic 1"
                className={`${field} flex-1`}
              />
              <select
                value={levelCat}
                onChange={(e) => setLevelCat(e.target.value)}
                className={field}
              >
                {['PRE_SCHOOL', 'PRIMARY', 'JHS', 'SHS'].map((c) => (
                  <option key={c} value={c}>
                    {c.toLowerCase().replace('_', ' ')}
                  </option>
                ))}
              </select>
              <button className="rounded-lg bg-brand text-paper text-sm px-3 hover:bg-brand-deep transition">
                Add
              </button>
            </form>
          </div>

          <div>
            <p className="text-[13px] font-medium mb-2">Classes</p>
            <ul className="space-y-1 text-sm">
              {classes.map((c) => (
                <li key={c.id} className="flex items-center justify-between">
                  <span>
                    {c.name} <span className="text-oat text-xs">· {c.studentCount} students</span>
                  </span>
                  <button
                    onClick={() => send(`classes/${c.id}`, undefined, 'DELETE')}
                    className="text-[12px] text-clay hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="flex gap-2 mt-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await send('classes', { name: className, levelId: classLevelId }))
                  setClassName('');
              }}
            >
              <input
                required
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                placeholder="Basic 1"
                className={`${field} flex-1`}
              />
              <select
                required
                value={classLevelId}
                onChange={(e) => setClassLevelId(e.target.value)}
                className={field}
              >
                <option value="">— level —</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <button className="rounded-lg bg-brand text-paper text-sm px-3 hover:bg-brand-deep transition">
                Add
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* Subjects */}
      <section className="card p-6 rise rise-4">
        <h2 className="font-display text-xl">Subjects</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {subjects.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-full border border-mist px-3 py-1 text-[13px]"
            >
              <span>
                {s.name} <span className="text-oat">({s.code})</span>
                {s.isCore && <span className="ml-1 text-[10px] uppercase text-brand">core</span>}
              </span>
              <button
                onClick={() => send(`subjects/${s.id}`, undefined, 'DELETE')}
                className="text-clay"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap gap-2 mt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await send('subjects', { name: subjName, code: subjCode, isCore: subjCore })) {
              setSubjName('');
              setSubjCode('');
            }
          }}
        >
          <input
            required
            value={subjName}
            onChange={(e) => setSubjName(e.target.value)}
            placeholder="Mathematics"
            className={`${field} w-56`}
          />
          <input
            required
            value={subjCode}
            onChange={(e) => setSubjCode(e.target.value)}
            placeholder="MATH"
            className={`${field} w-28`}
          />
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={subjCore}
              onChange={(e) => setSubjCore(e.target.checked)}
            />
            Core
          </label>
          <button className="rounded-lg bg-brand text-paper text-sm px-4 hover:bg-brand-deep transition">
            Add subject
          </button>
        </form>
      </section>
    </div>
  );
}
