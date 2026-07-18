import { api } from '@/lib/api';

interface Checklist {
  items: { id: string; label: string; kind: string; required: boolean; onFile: boolean }[];
  missing: number;
  complete: boolean;
}

/**
 * What the school asks for at this child's level, and what is actually on file.
 *
 * Server-rendered on purpose: uploading a document from the panel above calls `router.refresh()`,
 * which re-runs this and moves the item across without the two panels having to talk to each
 * other. Completion is worked out by document kind on the API side.
 */
export default async function StudentChecklist({ studentId }: { studentId: string }) {
  const c = await api<Checklist>(`/records/students/${studentId}/checklist`);
  if (c.items.length === 0) return null;

  return (
    <section className="card p-6 rise rise-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl">Document checklist</h2>
        <span
          className={`text-[10px] uppercase tracking-wider rounded-full px-2.5 py-1 ${
            c.complete ? 'bg-parchment text-leaf' : 'bg-clay/10 text-clay'
          }`}
        >
          {c.complete ? 'Complete' : `${c.missing} outstanding`}
        </span>
      </div>
      <ul className="mt-4 space-y-2">
        {c.items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 text-sm">
            <span
              aria-hidden
              className={`w-4 h-4 rounded-full shrink-0 border ${
                i.onFile ? 'bg-leaf border-leaf' : 'border-mist'
              }`}
            />
            <span className={i.onFile ? '' : 'text-oat'}>
              {i.label}
              {!i.required && <span className="text-[11px] text-oat ml-2">optional</span>}
            </span>
            <span className="ml-auto text-[11px] text-oat">
              {i.onFile ? 'On file' : 'Not received'}
            </span>
          </li>
        ))}
      </ul>
      {!c.complete && (
        <p className="text-[11px] text-oat mt-3">
          Upload what is missing under Photo &amp; documents above, choosing the matching kind.
        </p>
      )}
    </section>
  );
}
