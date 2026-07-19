'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useAsyncAction } from '@/components/Button';
import { SaveIcon } from '@/components/icons';

/**
 * Allergies, conditions and medication the office must know about in a hurry. Edited in place
 * rather than buried in a form, because it is read far more often than it is written.
 */
export default function MedicalNotes({
  studentId,
  notes,
}: {
  studentId: string;
  notes: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useAsyncAction(async () => {
    setError(null);
    const res = await fetch(`/api/proxy/students/${studentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ medicalNotes: value }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      // The button can only say "Couldn't save"; the server's reason is the useful half.
      setError(d.message ?? 'Could not save.');
      throw new Error('save rejected');
    }
    setEditing(false);
    router.refresh();
  });

  return (
    <section className="card p-6 rise rise-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl">Medical notes</h2>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="no-print text-[12.5px] font-medium text-brand hover:underline underline-offset-2"
          >
            {notes ? 'Edit' : '+ Add'}
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-3">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={4}
            autoFocus
            placeholder="Allergies, conditions, medication, emergency instructions…"
            className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
          <div className="flex items-center gap-3 mt-2">
            <Button onClick={save.run} state={save.state} icon={<SaveIcon />}>
              Save
            </Button>
            <button
              onClick={() => {
                setEditing(false);
                setValue(notes ?? '');
              }}
              className="min-h-11 px-2 text-[13px] text-oat hover:text-brand transition"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-sm text-danger mt-2">{error}</p>}
        </div>
      ) : notes ? (
        <p className="text-sm mt-2 whitespace-pre-wrap">{notes}</p>
      ) : (
        <p className="text-sm text-oat mt-2">Nothing recorded.</p>
      )}
    </section>
  );
}
