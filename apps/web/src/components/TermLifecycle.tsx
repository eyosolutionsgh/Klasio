'use client';

import { useState } from 'react';
import { Button, useAsyncAction } from './Button';

/**
 * Closing a term, and reopening one.
 *
 * A term is not a date range that elapses — a school *closes* it, once exams are marked, reports
 * vetted and published, and returns filed. Closing settles the register and the marks; the fee
 * ledger deliberately stays open, because arrears carry forward and parents settle old bills.
 *
 * The close asks first and shows what is outstanding, because the commonest thing to have missed
 * is a class whose reports were never generated — and the commonest *correct* answer is still to
 * go ahead, since a school closing a forgotten term in October cannot be blocked by an unmarked
 * register from April. It informs; the head decides.
 *
 * Reopening demands a reason for the same reason a ledger reversal does: afterwards, the audit
 * row is the only thing that tells a correction apart from someone rewriting history.
 */
interface Checklist {
  name: string;
  reportsTotal: number;
  reportsUnpublished: number;
  classesWithoutReports: number;
}

export default function TermLifecycle({
  termId,
  termName,
  closedAt,
  yearClosed,
  nextTerms,
  onDone,
}: {
  termId: string;
  termName: string;
  closedAt: string | null;
  /** A term inside a closed year cannot be reopened until the year is. */
  yearClosed: boolean;
  /** Open terms this school could switch to in the same act. */
  nextTerms: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [stage, setStage] = useState<'idle' | 'closing' | 'reopening'>('idle');
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [openTermId, setOpenTermId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body: unknown) {
    setError(null);
    const res = await fetch(`/api/proxy/school/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(Array.isArray(data.message) ? data.message.join('. ') : (data.message ?? 'That did not work.'));
      throw new Error('rejected');
    }
    setStage('idle');
    setReason('');
    onDone();
  }

  const begin = useAsyncAction(async () => {
    setError(null);
    const res = await fetch(`/api/proxy/school/terms/${termId}/checklist`);
    // The checklist is a courtesy, not a gate — if it cannot be fetched, still offer the close.
    setChecklist(res.ok ? await res.json() : null);
    setStage('closing');
  });

  const close = useAsyncAction(() =>
    post(`terms/${termId}/close`, openTermId ? { openTermId } : {}),
  );
  const reopen = useAsyncAction(() => post(`terms/${termId}/reopen`, { reason: reason.trim() }));

  if (closedAt) {
    return (
      <>
        <span className="text-[10px] uppercase tracking-wider bg-mist text-oat rounded-full px-2 py-0.5">
          Closed
        </span>
        {stage === 'reopening' ? (
          <form onSubmit={reopen.run} className="w-full mt-2 rounded-lg border border-mist p-3">
            <label className="block">
              <span className="text-xs uppercase tracking-widest text-oat">
                Why reopen {termName}?
              </span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                minLength={4}
                placeholder="A marking error came to light in September"
                className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand"
              />
            </label>
            <div className="flex items-center gap-3 mt-3">
              <Button
                type="submit"
                size="sm"
                state={reopen.state}
                pendingLabel="Reopening…"
                doneLabel="Reopened!"
                failedLabel="Couldn't reopen"
              >
                Reopen term
              </Button>
              <button
                type="button"
                onClick={() => setStage('idle')}
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
          </form>
        ) : (
          <button
            onClick={() => setStage('reopening')}
            disabled={yearClosed}
            title={yearClosed ? 'Reopen the academic year first' : undefined}
            className="text-[12px] font-medium text-brand hover:underline underline-offset-2 disabled:text-oat disabled:no-underline disabled:cursor-not-allowed"
          >
            Reopen
          </button>
        )}
      </>
    );
  }

  if (stage === 'closing') {
    return (
      <div className="w-full mt-2 rounded-lg border border-clay/30 bg-clay/5 p-4">
        <p className="font-medium text-sm">Close {termName}?</p>
        <p className="text-[13px] text-oat mt-1.5 max-w-prose">
          The register and the marks for this term become settled — no more attendance, scores or
          report generation until it is reopened. <span className="text-ink">Fees are not
          affected</span>: balances carry forward and parents can still pay.
        </p>
        {checklist && (
          <ul className="mt-3 text-[13px] space-y-1">
            <li className={checklist.reportsUnpublished > 0 ? 'text-clay' : 'text-oat'}>
              {checklist.reportsUnpublished > 0
                ? `${checklist.reportsUnpublished} of ${checklist.reportsTotal} reports are not published yet`
                : `All ${checklist.reportsTotal} reports are published`}
            </li>
            {checklist.classesWithoutReports > 0 && (
              <li className="text-clay">
                {checklist.classesWithoutReports} class(es) have pupils but no reports generated
              </li>
            )}
          </ul>
        )}
        {nextTerms.length > 0 && (
          <label className="block mt-4">
            <span className="text-xs uppercase tracking-widest text-oat">
              And open (optional)
            </span>
            <select
              value={openTermId}
              onChange={(e) => setOpenTermId(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm"
            >
              <option value="">Leave the current term as it is</option>
              {nextTerms.map((t) => (
                <option key={t.id} value={t.id}>
                  Make {t.name} the current term
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-center gap-3 mt-4">
          <Button
            onClick={close.run}
            size="sm"
            state={close.state}
            pendingLabel="Closing…"
            doneLabel="Closed!"
            failedLabel="Couldn't close"
          >
            {`Close ${termName}`}
          </Button>
          <button
            onClick={() => setStage('idle')}
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
      </div>
    );
  }

  return (
    <button
      onClick={begin.run}
      className="text-[12px] font-medium text-brand hover:underline underline-offset-2"
    >
      Close term
    </button>
  );
}
