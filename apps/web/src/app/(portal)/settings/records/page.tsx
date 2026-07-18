'use client';

import { useCallback, useEffect, useState } from 'react';

interface FieldDef {
  id: string;
  label: string;
  kind: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'CHOICE';
  options: string[];
  levelId: string | null;
  required: boolean;
  order: number;
}
interface Requirement {
  id: string;
  label: string;
  kind: string;
  levelId: string | null;
  required: boolean;
  order: number;
}
interface Remark {
  id: string;
  kind: 'TEACHER' | 'HEAD' | 'CONDUCT' | 'INTEREST';
  text: string;
  minScore: number | null;
  maxScore: number | null;
  uses: number;
}
interface Level {
  id: string;
  name: string;
}

const KINDS = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'CHOICE'] as const;
const REMARK_KINDS = ['TEACHER', 'HEAD', 'CONDUCT', 'INTEREST'] as const;
const kindLabel: Record<string, string> = {
  TEXT: 'Text',
  NUMBER: 'Number',
  DATE: 'Date',
  BOOLEAN: 'Yes / no',
  CHOICE: 'Pick from a list',
};
const remarkLabel: Record<string, string> = {
  TEACHER: 'Class teacher',
  HEAD: 'Head teacher',
  CONDUCT: 'Conduct',
  INTEREST: 'Interest',
};

const field =
  'rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

export default function RecordsSettingsPage() {
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [remarks, setRemarks] = useState<Remark[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const [kind, setKind] = useState<(typeof KINDS)[number]>('TEXT');

  const load = useCallback(async () => {
    const [f, r, b, st] = await Promise.all([
      fetch('/api/proxy/records/fields').then((x) => x.json()),
      fetch('/api/proxy/records/requirements').then((x) => x.json()),
      fetch('/api/proxy/remarks').then((x) => x.json()),
      fetch('/api/proxy/school/structure').then((x) => x.json()),
    ]);
    setFields(Array.isArray(f) ? f : []);
    setRequirements(Array.isArray(r) ? r : []);
    setRemarks(Array.isArray(b) ? b : []);
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

  const scopeLabel = (levelId: string | null) =>
    levelId ? (levels.find((l) => l.id === levelId)?.name ?? 'one level') : 'Every level';

  const band = (r: Remark) =>
    r.minScore === null && r.maxScore === null
      ? 'Any score'
      : `${r.minScore ?? 0}–${r.maxScore ?? 100}`;

  return (
    <div className="space-y-8">
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Records setup</h1>
        <p className="text-sm text-oat mt-1.5">
          The extra details your school keeps on every child, the documents each level must have on
          file, and the report-card comments teachers can reach for.
        </p>
        {message && <p className="text-sm text-danger mt-2">{message}</p>}
      </div>

      <section className="card p-6 rise rise-2">
        <h2 className="font-display text-xl">Extra student fields</h2>
        <p className="text-xs text-oat mt-1">
          Anything you record that we do not ship — NHIS number, house, bus stop. Fields set to a
          level only appear on children in that level. Removing a field also removes everything
          recorded in it.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist">
                <th className="py-2 font-medium">Field</th>
                <th className="py-2 pr-6 font-medium">Type</th>
                <th className="py-2 pr-6 font-medium">Applies to</th>
                <th className="py-2 pr-6 font-medium">Required</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.id} className="border-b border-mist/50 last:border-0">
                  <td className="py-2.5 font-medium">
                    {f.label}
                    {f.kind === 'CHOICE' && f.options.length > 0 && (
                      <span className="block text-[11px] text-oat font-normal">
                        {f.options.join(' · ')}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-6 text-xs text-oat">{kindLabel[f.kind] ?? f.kind}</td>
                  <td className="py-2.5 pr-6 text-xs text-oat">{scopeLabel(f.levelId)}</td>
                  <td className="py-2.5 pr-6 text-xs">{f.required ? 'Yes' : '—'}</td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => send(`records/fields/${f.id}`, undefined, 'DELETE')}
                      className="text-[12px] text-clay hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {fields.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-xs text-oat">
                    No extra fields yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <form
          className="flex flex-wrap items-end gap-2 mt-4 pt-4 border-t border-mist/60"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            const levelId = String(f.get('levelId') ?? '');
            const options = String(f.get('options') ?? '')
              .split(',')
              .map((o) => o.trim())
              .filter(Boolean);
            const ok = await send('records/fields', {
              label: String(f.get('label') ?? '').trim(),
              kind,
              required: f.get('required') === 'on',
              // Omitted rather than sent empty — the API reads absent as "every level".
              ...(levelId ? { levelId } : {}),
              ...(kind === 'CHOICE' ? { options } : {}),
            });
            if (ok) {
              form.reset();
              setKind('TEXT');
            }
          }}
        >
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Field name</span>
            <input
              name="label"
              required
              minLength={2}
              placeholder="NHIS number"
              className={`${field} w-44`}
            />
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Type</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
              className={field}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel[k]}
                </option>
              ))}
            </select>
          </label>
          {kind === 'CHOICE' && (
            <label className="text-[13px]">
              <span className="block text-oat mb-1">Options — comma separated</span>
              <input
                name="options"
                required
                placeholder="Blue, Gold, Green"
                className={`${field} w-56`}
              />
            </label>
          )}
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Level</span>
            <select name="levelId" className={field}>
              <option value="">Every level</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[13px] flex items-center gap-2 min-h-11">
            <input type="checkbox" name="required" className="accent-brand" />
            <span>Required</span>
          </label>
          <button className="min-h-11 rounded-lg bg-brand text-paper text-sm font-medium px-4 hover:bg-brand-deep transition">
            Add field
          </button>
        </form>
      </section>

      <section className="card p-6 rise rise-3">
        <h2 className="font-display text-xl">Documents on file</h2>
        <p className="text-xs text-oat mt-1">
          What every child at a level is expected to have. A document counts as on file when one of
          that kind has been uploaded to the student — so the kind here must match the kind chosen
          when uploading.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist">
                <th className="py-2 font-medium">Document</th>
                <th className="py-2 pr-6 font-medium">Kind</th>
                <th className="py-2 pr-6 font-medium">Applies to</th>
                <th className="py-2 pr-6 font-medium">Required</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {requirements.map((r) => (
                <tr key={r.id} className="border-b border-mist/50 last:border-0">
                  <td className="py-2.5 font-medium">{r.label}</td>
                  <td className="py-2.5 pr-6 text-xs text-oat tabular">{r.kind}</td>
                  <td className="py-2.5 pr-6 text-xs text-oat">{scopeLabel(r.levelId)}</td>
                  <td className="py-2.5 pr-6 text-xs">{r.required ? 'Yes' : 'Optional'}</td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => send(`records/requirements/${r.id}`, undefined, 'DELETE')}
                      className="text-[12px] text-clay hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {requirements.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-xs text-oat">
                    Nothing required yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <form
          className="flex flex-wrap items-end gap-2 mt-4 pt-4 border-t border-mist/60"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            const levelId = String(f.get('levelId') ?? '');
            const ok = await send('records/requirements', {
              label: String(f.get('label') ?? '').trim(),
              kind: String(f.get('kind') ?? 'OTHER'),
              required: f.get('required') === 'on',
              ...(levelId ? { levelId } : {}),
            });
            if (ok) form.reset();
          }}
        >
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Document name</span>
            <input
              name="label"
              required
              minLength={2}
              placeholder="Birth certificate"
              className={`${field} w-48`}
            />
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Kind</span>
            <select name="kind" defaultValue="BIRTH_CERTIFICATE" className={field}>
              <option value="BIRTH_CERTIFICATE">birth certificate</option>
              <option value="IMMUNISATION">immunisation</option>
              <option value="PREVIOUS_REPORT">previous report</option>
              <option value="OTHER">other</option>
            </select>
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Level</span>
            <select name="levelId" className={field}>
              <option value="">Every level</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[13px] flex items-center gap-2 min-h-11">
            <input type="checkbox" name="required" defaultChecked className="accent-brand" />
            <span>Required</span>
          </label>
          <button className="min-h-11 rounded-lg bg-brand text-paper text-sm font-medium px-4 hover:bg-brand-deep transition">
            Add document
          </button>
        </form>
      </section>

      <section className="card p-6 rise rise-4">
        <h2 className="font-display text-xl">Remark bank</h2>
        <p className="text-xs text-oat mt-1">
          Comments teachers can pick from when writing reports. Give a score band and the comment is
          offered first to children in that band; leave it open and it is offered to anyone. The
          ones used most often rise to the top on their own.
        </p>
        <div className="mt-4 space-y-4">
          {REMARK_KINDS.filter((k) => remarks.some((r) => r.kind === k)).map((k) => (
            <div key={k} className="border-t border-mist/60 pt-3 first:border-0 first:pt-0">
              <p className="text-[11px] uppercase tracking-widest text-oat">{remarkLabel[k]}</p>
              <ul className="mt-2 space-y-1.5">
                {remarks
                  .filter((r) => r.kind === k)
                  .map((r) => (
                    <li key={r.id} className="flex items-start justify-between gap-3 text-sm">
                      <span className="min-w-0">
                        {r.text}
                        <span className="text-oat text-[11px] ml-2 tabular">
                          {band(r)} · used {r.uses}×
                        </span>
                      </span>
                      <button
                        onClick={() => send(`remarks/${r.id}`, undefined, 'DELETE')}
                        className="text-[12px] text-clay hover:underline shrink-0"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          {remarks.length === 0 && <p className="text-xs text-oat">No remarks banked yet.</p>}
        </div>

        <form
          className="mt-5 pt-5 border-t border-mist/60 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            const min = String(f.get('minScore') ?? '');
            const max = String(f.get('maxScore') ?? '');
            const ok = await send('remarks', {
              kind: String(f.get('kind') ?? 'TEACHER'),
              text: String(f.get('text') ?? '').trim(),
              // Sent only when typed — an empty band means "suits any score", not 0–0.
              ...(min ? { minScore: Number(min) } : {}),
              ...(max ? { maxScore: Number(max) } : {}),
            });
            if (ok) form.reset();
          }}
        >
          <h3 className="font-medium text-sm">Add a remark</h3>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[13px]">
              <span className="block text-oat mb-1">For</span>
              <select name="kind" defaultValue="TEACHER" className={field}>
                {REMARK_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {remarkLabel[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[13px]">
              <span className="block text-oat mb-1">From</span>
              <input
                name="minScore"
                type="number"
                min="0"
                max="100"
                placeholder="—"
                className={`${field} w-20 tabular`}
              />
            </label>
            <label className="text-[13px]">
              <span className="block text-oat mb-1">To</span>
              <input
                name="maxScore"
                type="number"
                min="0"
                max="100"
                placeholder="—"
                className={`${field} w-20 tabular`}
              />
            </label>
          </div>
          <label className="block text-[13px]">
            <span className="block text-oat mb-1">Comment</span>
            <input
              name="text"
              required
              minLength={3}
              placeholder="A steady term’s work. Keep up the reading at home."
              className={`${field} w-full`}
            />
          </label>
          <button className="min-h-11 rounded-lg bg-brand text-paper text-sm font-medium px-4 hover:bg-brand-deep transition">
            Add remark
          </button>
        </form>
      </section>
    </div>
  );
}
