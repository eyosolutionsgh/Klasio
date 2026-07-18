'use client';

import { useState } from 'react';

interface Planned {
  name: string;
  balance: number;
  tone: string;
}

/**
 * Fee reminders to everyone currently owing. Previewed before sending — this spends the
 * school's SMS credit and lands on parents' phones, so it should never be a single blind click.
 */
export default function SendReminders({ termId, currency }: { termId: string; currency: string }) {
  const [preview, setPreview] = useState<Planned[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const money = (n: number) =>
    `${currency} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2 })}`;

  async function run(dryRun: boolean) {
    setBusy(true);
    setResult(null);
    const res = await fetch(`/api/proxy/fees/reminders?termId=${termId}&dryRun=${dryRun}`, {
      method: 'POST',
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setResult(body.message ?? 'Could not send reminders.');
      return;
    }
    if (dryRun) {
      setPreview(body.planned ?? []);
    } else {
      setPreview(null);
      setResult(
        `Sent ${body.sent} reminder${body.sent === 1 ? '' : 's'}.` +
          (body.skipped
            ? ` ${body.skipped} skipped — already reminded today, no phone, or out of credit.`
            : ''),
      );
    }
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => run(true)}
          disabled={busy || !termId}
          className="min-h-11 rounded-lg border border-brand/40 text-brand text-sm font-medium px-4 hover:bg-brand-mist transition disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Preview fee reminders'}
        </button>
        {preview && preview.length > 0 && (
          <button
            onClick={() => run(false)}
            disabled={busy}
            className="min-h-11 rounded-lg bg-brand text-paper text-sm font-medium px-4 hover:bg-brand-deep transition disabled:opacity-50"
          >
            Send to {preview.length}
          </button>
        )}
      </div>

      {preview && (
        <div className="mt-3">
          {preview.length === 0 ? (
            <p className="text-sm text-oat">Nobody owes anything — no reminders to send.</p>
          ) : (
            <>
              <p className="text-[13px] text-oat">
                {preview.length} famil{preview.length === 1 ? 'y' : 'ies'} would be texted. Anyone
                already reminded today is skipped.
              </p>
              <ul className="mt-2 max-h-40 overflow-y-auto text-[13px] space-y-1">
                {preview.map((p) => (
                  <li key={p.name} className="flex justify-between gap-3">
                    <span className="truncate">
                      {p.name}
                      <span className="text-oat"> · {p.tone}</span>
                    </span>
                    <span className="tabular text-clay shrink-0">{money(p.balance)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {result && <p className="text-sm mt-3 text-leaf">{result}</p>}
    </div>
  );
}
