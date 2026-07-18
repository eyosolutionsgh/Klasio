'use client';

import { useCallback, useEffect, useState } from 'react';

interface Field {
  id: string;
  label: string;
  kind: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'CHOICE';
  options: string[];
  required: boolean;
  value: string;
}

const input =
  'w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

/**
 * The school's own extra fields for this child. Which fields appear depends on the child's level,
 * so the list comes from the API rather than being built here.
 *
 * Saved as one submission: the API refuses the whole batch if any value does not match its field's
 * kind, and hands back the stored values, so what is on screen after a save is what is in the
 * database rather than what was typed.
 */
export default function StudentCustomFields({ studentId }: { studentId: string }) {
  const [fields, setFields] = useState<Field[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((rows: Field[]) => {
    setFields(rows);
    setDraft(Object.fromEntries(rows.map((f) => [f.id, f.value])));
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/proxy/records/students/${studentId}/fields`);
    if (res.ok) apply(await res.json());
  }, [studentId, apply]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/proxy/records/students/${studentId}/fields`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: fields.map((f) => ({ fieldId: f.id, value: draft[f.id] ?? '' })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      apply(data);
      setEditing(false);
    } else {
      setError(data.message ?? 'Could not save.');
    }
  }

  // Nothing to show until the school sets some up — an empty card is just noise on the page.
  if (fields.length === 0) return null;

  const shown = (f: Field) => {
    if (!f.value) return <span className="text-oat">—</span>;
    if (f.kind === 'BOOLEAN') return f.value === 'true' ? 'Yes' : 'No';
    return f.value;
  };

  return (
    <section className="card p-6 rise rise-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl">Other details</h2>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="no-print text-[12.5px] font-medium text-brand hover:underline underline-offset-2"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-3 space-y-3">
          {fields.map((f) => (
            <label key={f.id} className="block text-[13px]">
              <span className="block text-oat mb-1">
                {f.label}
                {f.required && <span className="text-clay ml-1">*</span>}
              </span>
              {f.kind === 'CHOICE' ? (
                <select
                  value={draft[f.id] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [f.id]: e.target.value })}
                  className={input}
                >
                  <option value="">—</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : f.kind === 'BOOLEAN' ? (
                <select
                  value={draft[f.id] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [f.id]: e.target.value })}
                  className={input}
                >
                  <option value="">—</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : (
                <input
                  // type=date gives the browser's picker, which is also what keeps the value in
                  // the yyyy-mm-dd shape the API insists on.
                  type={f.kind === 'DATE' ? 'date' : f.kind === 'NUMBER' ? 'number' : 'text'}
                  value={draft[f.id] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [f.id]: e.target.value })}
                  className={input}
                />
              )}
            </label>
          ))}
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={busy}
              className="min-h-11 rounded-lg bg-brand text-paper text-sm font-medium px-4 hover:bg-brand-deep transition disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setError(null);
                apply(fields);
              }}
              className="min-h-11 px-2 text-[13px] text-oat hover:text-brand transition"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      ) : (
        <dl className="mt-3 space-y-1.5">
          {fields.map((f) => (
            <div key={f.id} className="flex items-baseline justify-between gap-3 text-sm">
              <dt className="text-oat text-[13px]">{f.label}</dt>
              <dd className="text-right">{shown(f)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
