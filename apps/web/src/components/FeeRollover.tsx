'use client';

import { useEffect, useState } from 'react';
import Combobox from './Combobox';
import { Button, useAsyncAction } from './Button';
import { CashIcon } from './icons';

export interface TermOption {
  id: string;
  label: string;
}

/**
 * Copy a term's fee items into another term.
 *
 * Without this a school retypes its whole fee structure three times a year, and invoice
 * generation refuses until they do — so it sits directly above the empty table it fills. Items
 * already present in the target term are left alone and reported as skipped, never as failures.
 */
export default function FeeRollover({
  terms,
  currentTermId,
  onDone,
}: {
  terms: TermOption[];
  currentTermId: string;
  onDone: () => void;
}) {
  const [fromTermId, setFromTermId] = useState('');
  const [toTermId, setToTermId] = useState('');

  /**
   * The parent loads the terms after its first paint, so these cannot be `useState` initialisers
   * — they would be seeded from an empty list and leave both pickers blank for good. Seeding runs
   * once the terms arrive and never overwrites a choice the user has already made.
   */
  useEffect(() => {
    if (terms.length === 0 || fromTermId || toTermId) return;
    // The common case is "bring last term forward into the one I am looking at", so the target
    // defaults to the current term and the source to the one before it.
    const i = terms.findIndex((t) => t.id === currentTermId);
    setToTermId(currentTermId || terms[terms.length - 1].id);
    setFromTermId(i > 0 ? terms[i - 1].id : terms[0].id);
  }, [terms, currentTermId, fromTermId, toTermId]);

  const [result, setResult] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const copy = useAsyncAction(async () => {
    setResult(null);
    const res = await fetch('/api/proxy/fees/items/rollover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromTermId, toTermId }),
    });
    const body = await res.json().catch(() => ({}));
    setFailed(!res.ok);
    if (!res.ok) {
      setResult(body.message ?? 'Could not copy the fee items.');
      // The button can only say it failed; the server names which terms or items were the problem.
      throw new Error('rollover rejected');
    }
    setResult(
      `Copied ${body.copied} fee item${body.copied === 1 ? '' : 's'} into ${body.toTerm}.` +
        // "Skipped" means already there, not rejected — saying so stops it reading as an error.
        (body.skipped
          ? ` ${body.skipped} ${body.skipped === 1 ? 'was' : 'were'} already in that term and left alone.`
          : ''),
    );
    onDone();
  });

  if (terms.length < 2) return null;

  return (
    <section className="card p-6 rise rise-2 max-w-2xl">
      <h2 className="font-display text-xl">Bring a term&apos;s fees forward</h2>
      <p className="text-sm text-oat mt-1.5">
        Copies every fee item from one term into another so you do not retype the structure each
        term. Items already in the target term are left exactly as they are, so running this twice
        never duplicates a fee.
      </p>
      <div className="flex flex-wrap items-end gap-3 mt-4">
        <Combobox
          label="Copy from"
          className="w-full sm:w-60"
          allowClear={false}
          placeholder="Search terms…"
          options={terms.map((t) => ({ value: t.id, label: t.label }))}
          value={fromTermId}
          onChange={setFromTermId}
        />
        <Combobox
          label="Copy into"
          className="w-full sm:w-60"
          allowClear={false}
          placeholder="Search terms…"
          options={terms.map((t) => ({ value: t.id, label: t.label }))}
          value={toTermId}
          onChange={setToTermId}
        />
        <Button
          onClick={copy.run}
          state={copy.state}
          icon={<CashIcon />}
          disabled={!fromTermId || !toTermId || fromTermId === toTermId}
          data-tip={fromTermId === toTermId ? 'Choose two different terms' : undefined}
          className="tip"
          // "Copy" is not one of the verbs the button conjugates for itself.
          pendingLabel="Copying…"
          doneLabel="Copied!"
          failedLabel="Couldn't copy"
        >
          Copy fee items
        </Button>
      </div>
      {/* Kept even on success: the counts — how many copied, how many were already there — are
          the point, and the button can only say that it worked. */}
      {result && <p className={`text-sm mt-3 ${failed ? 'text-danger' : ''}`}>{result}</p>}
    </section>
  );
}
