'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, useAsyncAction } from './Button';
import { PlusIcon } from './icons';

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

/**
 * Connect Klasio to other systems (FEATURES.md §18): read-only API keys, shown once at minting
 * and recognisable afterwards only by their prefix. Hidden entirely on packages without the
 * API entitlement.
 */
export default function ApiKeysSettings() {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [minted, setMinted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/proxy/integrations/keys');
    setKeys(res.ok ? await res.json() : null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mint = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    const f = new FormData(form);
    setError(null);
    const res = await fetch('/api/proxy/integrations/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: String(f.get('name')) }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.message ?? 'Could not create the key.');
      throw new Error('rejected');
    }
    setMinted(d.key);
    form.reset();
    load();
  });

  async function revoke(k: KeyRow) {
    if (!confirm(`Revoke "${k.name}"? Whatever uses it stops working straight away.`)) return;
    const res = await fetch(`/api/proxy/integrations/keys/${k.id}`, { method: 'DELETE' });
    if (res.ok) load();
  }

  if (keys === null) return null;

  return (
    <section className="card p-6 rise rise-4">
      <h2 className="font-display text-xl">Connect other systems</h2>
      <p className="text-sm text-oat mt-1.5">
        Read-only API keys for systems your school already uses. They can read; they can never write
        a mark or a cedi. The surface lives under <code>/integration/v1</code> with an{' '}
        <code>x-api-key</code> header.
      </p>

      {minted && (
        <div className="mt-4 rounded-lg border border-gold/40 bg-gold-soft/40 p-4">
          <p className="text-sm font-medium">Your new key — shown once</p>
          <p className="font-mono text-[13px] tabular break-all mt-1">{minted}</p>
          <p className="text-[11px] text-oat mt-1">
            Klasio keeps only a hash. Copy it now; there is no reading it back.
          </p>
          <button
            onClick={() => setMinted(null)}
            className="mt-2 text-[13px] text-oat underline underline-offset-2"
          >
            I&apos;ve stored it
          </button>
        </div>
      )}

      <form onSubmit={mint.run} className="mt-4 flex flex-wrap gap-2">
        <input
          name="name"
          required
          minLength={2}
          placeholder="What will use it, e.g. Accounting system"
          className="flex-1 min-w-[14rem] min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
        />
        <Button type="submit" state={mint.state} icon={<PlusIcon />}>
          Create key
        </Button>
      </form>
      {error && <p className="text-sm text-danger mt-2">{error}</p>}

      <ul className="mt-4 space-y-2">
        {keys.map((k) => (
          <li
            key={k.id}
            className="flex items-center justify-between gap-3 border-b border-mist/50 last:border-0 pb-2 last:pb-0"
          >
            <div>
              <p className={`text-sm font-medium ${k.revoked ? 'line-through text-oat' : ''}`}>
                {k.name} <span className="font-mono text-[11px] text-oat">{k.prefix}…</span>
              </p>
              <p className="text-[11px] text-oat">
                {k.revoked
                  ? 'revoked'
                  : k.lastUsedAt
                    ? `last used ${new Date(k.lastUsedAt).toLocaleDateString('en-GH')}`
                    : 'never used'}
              </p>
            </div>
            {!k.revoked && (
              <button
                onClick={() => revoke(k)}
                className="text-[12px] text-clay hover:underline underline-offset-2 shrink-0"
              >
                Revoke
              </button>
            )}
          </li>
        ))}
        {keys.length === 0 && <li className="text-sm text-oat">No keys yet.</li>}
      </ul>
    </section>
  );
}
