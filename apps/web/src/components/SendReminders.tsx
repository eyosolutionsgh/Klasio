'use client';

import { useState } from 'react';
import { Button, useAsyncAction } from './Button';
import { SearchIcon, SendIcon } from './icons';

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
  const [error, setError] = useState<string | null>(null);
  /** How many went and how many were passed over — the button cannot carry a count. */
  const [summary, setSummary] = useState<string | null>(null);

  const money = (n: number) =>
    `${currency} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2 })}`;

  async function call(dryRun: boolean) {
    setError(null);
    setSummary(null);
    const res = await fetch(`/api/proxy/fees/reminders?termId=${termId}&dryRun=${dryRun}`, {
      method: 'POST',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.message ?? 'Could not send reminders.');
      throw new Error('rejected');
    }
    if (dryRun) {
      setPreview(body.planned ?? []);
    } else {
      setPreview(null);
      setSummary(
        `Sent ${body.sent} reminder${body.sent === 1 ? '' : 's'}.` +
          (body.skipped
            ? ` ${body.skipped} skipped — already reminded today, no phone, or out of credit.`
            : ''),
      );
    }
  }

  const previewAction = useAsyncAction(() => call(true));
  const sendAction = useAsyncAction(() => call(false));

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* A preview only looks — SearchIcon rather than the paper plane, which is the send. */}
        <Button
          onClick={previewAction.run}
          state={previewAction.state}
          variant="secondary"
          icon={<SearchIcon />}
          disabled={!termId || sendAction.state === 'pending'}
        >
          Preview fee reminders
        </Button>
        {preview && preview.length > 0 && (
          // Each button owns its own state, so they still lock each other out by hand — a send
          // must not be fired against a preview that is currently being replaced.
          <Button
            onClick={sendAction.run}
            state={sendAction.state}
            icon={<SendIcon />}
            disabled={previewAction.state === 'pending'}
          >
            {`Send to ${preview.length}`}
          </Button>
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
      {summary && <p className="text-sm mt-3 text-leaf">{summary}</p>}
      {error && <p className="text-sm mt-3 text-danger">{error}</p>}
    </div>
  );
}
