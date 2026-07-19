'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import FileField from './FileField';
import { Button, useAsyncAction } from './Button';
import { UploadIcon } from './icons';

const field =
  'w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

const PROVIDERS = [
  { v: 'HUBTEL', l: 'Hubtel' },
  { v: 'PAYSTACK', l: 'Paystack' },
  { v: 'MOCK', l: 'Test file' },
];

interface Summary {
  matched: number;
  unmatched: number;
  disputed: number;
  grossTotal: number;
  netTotal: number;
  chargesTotal: number;
  /** Payments we hold that this file never mentions — the other half of the picture. */
  missingReferences: string[];
}

/**
 * Import a settlement file.
 *
 * This moves no money: it compares the gateway's file against payments that already settled
 * through the webhook. The result summary is the only place `missingReferences` is ever shown —
 * the API computes it at import time and does not store it — so it is spelled out here rather
 * than reduced to a count.
 */
export default function ImportSettlement({ currency }: { currency: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [provider, setProvider] = useState('HUBTEL');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Summary | null>(null);

  const money = (n: number) =>
    `${currency} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const importFile = useAsyncAction(async () => {
    if (!file) {
      setError('Choose the settlement file your gateway sent you.');
      throw new Error('no file chosen');
    }
    setError(null);
    setResult(null);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/proxy/reconciliation/import/${provider}`, {
      method: 'POST',
      body: fd,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        Array.isArray(body.message)
          ? body.message.join('. ')
          : (body.message ?? 'Could not read that file.'),
      );
      throw new Error('import rejected');
    }
    setResult(body);
    setFile(null);
    router.refresh();
  });

  return (
    <form onSubmit={importFile.run} className="card p-6 h-fit rise rise-3">
      <h2 className="font-display text-xl">Import a settlement file</h2>
      <p className="text-xs text-oat mt-1">
        Nothing here credits a student. Importing only compares the gateway&apos;s file with
        payments already in the ledger.
      </p>

      <label className="block text-sm font-medium mt-5 mb-1.5" htmlFor="rec-provider">
        Gateway
      </label>
      <select
        id="rec-provider"
        value={provider}
        onChange={(e) => setProvider(e.target.value)}
        className={field}
      >
        {PROVIDERS.map((p) => (
          <option key={p.v} value={p.v}>
            {p.l}
          </option>
        ))}
      </select>

      <label className="block text-sm font-medium mt-4 mb-1.5" htmlFor="rec-file">
        File
      </label>
      <FileField
        id="rec-file"
        accept=".csv,text/csv"
        value={file}
        onChange={setFile}
        disabled={importFile.state === 'pending'}
        hint="The CSV as downloaded — columns are found by their headings, so the order does not matter. It needs a reference column and an amount column."
      />

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      <Button
        type="submit"
        state={importFile.state}
        icon={<UploadIcon />}
        className="mt-5"
        // "Import" conjugates itself, but reading the file is what the wait actually is.
        pendingLabel="Reading…"
      >
        Import and match
      </Button>

      {result && (
        <div role="status" className="mt-5 pt-5 border-t border-mist/60">
          <p className="text-sm">
            <span className="font-medium text-leaf">{result.matched} matched</span>
            {result.unmatched > 0 && (
              <span className="text-danger"> · {result.unmatched} not recognised</span>
            )}
            {result.disputed > 0 && (
              <span className="text-clay"> · {result.disputed} amount disagrees</span>
            )}
          </p>
          <p className="text-[12px] text-oat tabular mt-1">
            {money(result.grossTotal)} charged · {money(result.netTotal)} remitted ·{' '}
            {money(result.chargesTotal)} kept by the gateway
          </p>

          {/* The half nobody checks: a file that quietly omits a payment reads as a clean run. */}
          {result.missingReferences?.length > 0 && (
            <div className="mt-3 rounded-lg border border-clay/30 bg-clay/5 p-3">
              <p className="text-[12.5px] font-medium text-clay">
                {result.missingReferences.length} payment
                {result.missingReferences.length === 1 ? '' : 's'} we hold are not in this file
              </p>
              <p className="text-[11px] text-oat mt-1">
                We recorded these as settled but the gateway did not remit them here. Check the next
                payout, or query them. This list is worked out at import and is not kept — copy it
                now if you need it.
              </p>
              <p className="text-[11px] tabular text-ink mt-2 break-words">
                {result.missingReferences.join(', ')}
              </p>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
