'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useAsyncAction } from './Button';

/**
 * End of year, decided one child at a time.
 *
 * "Promote the class" is the common case and stays one click — every child arrives already set to
 * move up, into the class the server suggested. The point of this screen is the exception: the
 * child who repeats, the child going into a different stream, the one leaver in a class that is
 * not otherwise graduating. Before it existed, holding one child back meant promoting everyone
 * and then editing that child's record afterwards.
 *
 * Nothing is written until Apply, and the graduating count is sent with the request: graduation
 * cannot be undone, so the number on the screen has to be the number the server acts on.
 */
type Action = 'PROMOTE' | 'REPEAT' | 'GRADUATE';

interface PreviewStudent {
  studentId: string;
  name: string;
  admissionNo: string;
  suggestedAction: Action;
  suggestedToClassId: string | null;
}

interface Preview {
  fromClassId: string;
  fromClassName: string;
  isFinalClass: boolean;
  suggestedToClassName: string | null;
  classes: { id: string; name: string }[];
  students: PreviewStudent[];
}

interface Decision {
  action: Action;
  toClassId: string;
}

export default function PromotionReview({
  fromClassId,
  onClose,
}: {
  fromClassId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/proxy/students/promotion/preview?classId=${fromClassId}`);
    if (!res.ok) {
      setError('Could not load the class.');
      return;
    }
    const data: Preview = await res.json();
    setPreview(data);
    // Seed from the server's suggestion, so the common case needs no interaction at all.
    setDecisions(
      Object.fromEntries(
        data.students.map((s) => [
          s.studentId,
          { action: s.suggestedAction, toClassId: s.suggestedToClassId ?? '' },
        ]),
      ),
    );
  }, [fromClassId]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (studentId: string, patch: Partial<Decision>) =>
    setDecisions((d) => ({ ...d, [studentId]: { ...d[studentId], ...patch } }));

  const list = preview?.students ?? [];
  const counts = list.reduce(
    (acc, s) => {
      const a = decisions[s.studentId]?.action ?? 'PROMOTE';
      acc[a] += 1;
      return acc;
    },
    { PROMOTE: 0, REPEAT: 0, GRADUATE: 0 } as Record<Action, number>,
  );

  const apply = useAsyncAction(async () => {
    setError(null);
    setOutcome(null);
    const payload = list.map((s) => {
      const d = decisions[s.studentId];
      return {
        studentId: s.studentId,
        action: d.action,
        ...(d.action === 'PROMOTE' ? { toClassId: d.toClassId } : {}),
      };
    });
    const missing = payload.find((p) => p.action === 'PROMOTE' && !p.toClassId);
    if (missing) {
      setError('Every child being promoted needs a destination class.');
      throw new Error('incomplete');
    }
    const res = await fetch('/api/proxy/students/promotion/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromClassId,
        decisions: payload,
        // Sent even when zero, so the server never has to infer consent from the payload alone.
        confirmGraduating: counts.GRADUATE,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(Array.isArray(data.message) ? data.message.join('. ') : (data.message ?? 'That did not work.'));
      throw new Error('rejected');
    }
    setOutcome(
      `${data.promoted} promoted, ${data.repeated} repeating, ${data.graduated} graduated. Outstanding fees carried forward.`,
    );
    router.refresh();
  });

  if (!preview) {
    return (
      <div className="card p-4 text-sm text-oat">
        {error ?? `Loading ${fromClassId ? 'the class' : ''}…`}
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg">End of year — {preview.fromClassName}</h3>
        <p className="text-xs text-oat">
          {counts.PROMOTE} moving up · {counts.REPEAT} repeating · {counts.GRADUATE} graduating
        </p>
      </div>
      <p className="text-[13px] text-oat mt-1 max-w-prose">
        Everyone starts set to{' '}
        {preview.isFinalClass
          ? 'graduate, because this is your final class'
          : `move up to ${preview.suggestedToClassName ?? 'the next class'}`}
        . Change only the children who are doing something different. Nothing is saved until you
        apply, and outstanding fees follow every child either way.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm table-stack">
          <thead className="text-left text-[11px] uppercase tracking-widest text-oat">
            <tr>
              <th className="py-2 pr-3">Student</th>
              <th className="py-2 pr-3">Decision</th>
              <th className="py-2">Into</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => {
              const d = decisions[s.studentId] ?? { action: 'PROMOTE', toClassId: '' };
              return (
                <tr key={s.studentId} className="border-t border-mist/60">
                  <td className="py-2 pr-3" data-label="Student">
                    <span className="font-medium">{s.name}</span>{' '}
                    <span className="text-oat text-xs tabular">{s.admissionNo}</span>
                  </td>
                  <td className="py-2 pr-3" data-label="Decision">
                    <select
                      value={d.action}
                      onChange={(e) => set(s.studentId, { action: e.target.value as Action })}
                      aria-label={`Decision for ${s.name}`}
                      className="rounded-lg border border-mist bg-white px-2.5 py-1.5 text-sm"
                    >
                      <option value="PROMOTE">Move up</option>
                      <option value="REPEAT">Repeat the year</option>
                      <option value="GRADUATE">Graduate</option>
                    </select>
                  </td>
                  <td className="py-2" data-label="Into">
                    {d.action === 'PROMOTE' ? (
                      <select
                        value={d.toClassId}
                        onChange={(e) => set(s.studentId, { toClassId: e.target.value })}
                        aria-label={`Class for ${s.name}`}
                        className="rounded-lg border border-mist bg-white px-2.5 py-1.5 text-sm"
                      >
                        <option value="">— choose —</option>
                        {preview.classes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-oat text-xs">
                        {d.action === 'REPEAT' ? 'Stays in this class' : 'Leaves the school'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {counts.GRADUATE > 0 && (
        /* Named plainly, next to the button that does it — graduation cannot be undone here. */
        <p className="mt-4 text-[13px] text-danger max-w-prose">
          {counts.GRADUATE} student{counts.GRADUATE === 1 ? '' : 's'} will be marked as graduated
          and given today as their leaving date. This cannot be undone from the app.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 mt-5">
        <Button
          onClick={apply.run}
          state={apply.state}
          variant={counts.GRADUATE > 0 ? 'danger' : 'primary'}
          pendingLabel="Applying…"
          doneLabel="Applied!"
          failedLabel="Couldn't apply"
        >
          {`Apply to ${list.length} student${list.length === 1 ? '' : 's'}`}
        </Button>
        <button
          onClick={onClose}
          className="min-h-11 px-2 text-sm text-oat hover:text-brand transition"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger mt-2">
          {error}
        </p>
      )}
      {outcome && <p className="text-xs text-brand mt-2">{outcome}</p>}
    </div>
  );
}
