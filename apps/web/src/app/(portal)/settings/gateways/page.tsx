'use client';

import { useEffect, useState } from 'react';
import { Button, useAsyncAction } from '@/components/Button';
import { ChoiceCards } from '@/components/ChoiceCards';
import { CashIcon, KeyIcon, LockIcon } from '@/components/icons';

interface Gateway {
  id: string;
  provider: string;
  mode: string;
  active: boolean;
  publicKey: string | null;
  merchantNumber: string | null;
  hasSecret: boolean;
  updatedAt: string;
}

/** Labels stay as the enum spells them — a bursar matches these against the gateway's own portal. */
const PROVIDERS = [
  { value: 'PAYSTACK', label: 'PAYSTACK' },
  { value: 'HUBTEL', label: 'HUBTEL' },
] as const;
const MODES = [
  { value: 'TEST', label: 'TEST' },
  { value: 'LIVE', label: 'LIVE' },
] as const;

export default function GatewaysPage() {
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [provider, setProvider] = useState<'PAYSTACK' | 'HUBTEL'>('PAYSTACK');
  const [mode, setMode] = useState<'TEST' | 'LIVE'>('TEST');
  const [secret, setSecret] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [merchantNumber, setMerchantNumber] = useState('');
  // Only the failure reason: the button carries the outcome, and on success the table above
  // reloads to show the provider and mode that were just connected.
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/proxy/payments/gateway');
    if (res.ok) setGateways(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

  const connect = useAsyncAction(async () => {
    setError(null);
    const res = await fetch('/api/proxy/payments/gateway', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        mode,
        secret,
        publicKey: publicKey || undefined,
        merchantNumber: merchantNumber || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message ?? 'Could not save gateway credentials.');
      throw new Error('rejected');
    }
    setSecret('');
    load();
  });

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Payment gateways</h1>
        <p className="text-sm text-oat mt-1.5">
          Connect your school&apos;s own Hubtel or Paystack account — fees settle directly to you.
          Keys are encrypted before they are stored and are never shown again.
        </p>
      </div>

      {/*
        Unpaged and unsorted on purpose: the table can only ever hold one row per provider and
        mode, so there is nothing to page through and no order a reader would want to change.
      */}
      <div className="card mt-6 overflow-x-auto rise rise-2 table-stack-wrap">
        <table className="w-full text-sm table-stack">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <th className="px-5 py-3 font-medium">Provider</th>
              <th className="px-5 py-3 font-medium">Mode</th>
              <th className="px-5 py-3 font-medium">Public key / merchant</th>
              <th className="px-5 py-3 font-medium">Secret</th>
            </tr>
          </thead>
          <tbody>
            {gateways.map((g) => (
              <tr key={g.id} className="border-b border-mist/60 last:border-0">
                <td data-label="Provider" className="px-5 py-3 font-medium">
                  {g.provider}
                </td>
                <td data-label="Mode" className="px-5 py-3">
                  <span
                    className={`text-[11px] uppercase tracking-wider rounded-full px-2 py-0.5 ${g.mode === 'LIVE' ? 'bg-leaf/10 text-leaf' : 'bg-parchment text-oat'}`}
                  >
                    {g.mode}
                  </span>
                </td>
                <td
                  data-label="Public key / merchant"
                  className="px-5 py-3 text-oat tabular text-xs"
                >
                  {g.publicKey ?? g.merchantNumber ?? '—'}
                </td>
                <td data-label="Secret" className="px-5 py-3 text-oat">
                  {g.hasSecret ? 'stored ✓' : '—'}
                </td>
              </tr>
            ))}
            {gateways.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-oat">
                  No gateway connected — online payments run against a test gateway that moves no
                  real money.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={connect.run} className="card p-6 mt-6 rise rise-3 max-w-xl space-y-4">
        <h2 className="font-display text-xl">Connect a gateway</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <ChoiceCards
            legend="Provider"
            name="provider"
            value={provider}
            onChange={setProvider}
            options={PROVIDERS}
          />
          <ChoiceCards legend="Mode" name="mode" value={mode} onChange={setMode} options={MODES} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="secret">
            {provider === 'PAYSTACK' ? 'Secret key' : 'Client secret'}
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
              <LockIcon />
            </span>
            <input
              id="secret"
              type="password"
              required
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={provider === 'PAYSTACK' ? 'sk_live_…' : 'client secret'}
              className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 pl-10 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="pk">
            {provider === 'PAYSTACK' ? 'Public key' : 'Client ID'}
          </label>
          {/* KeyIcon, not LockIcon: this half of the pair is the public one, nothing to guard. */}
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
              <KeyIcon />
            </span>
            <input
              id="pk"
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 pl-10 text-sm outline-none focus:border-brand"
            />
          </div>
        </div>
        {provider === 'HUBTEL' && (
          <div>
            <label className="block text-sm font-medium mb-1.5" htmlFor="mn">
              Merchant account number
            </label>
            <input
              id="mn"
              value={merchantNumber}
              onChange={(e) => setMerchantNumber(e.target.value)}
              className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand"
            />
          </div>
        )}

        {/* "Connect" is not one of the conjugated verbs, so the three states are spelled out. */}
        <Button
          type="submit"
          state={connect.state}
          disabled={!secret}
          icon={<CashIcon />}
          pendingLabel="Connecting…"
          doneLabel="Connected!"
          failedLabel="Couldn't connect"
        >
          Connect gateway
        </Button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </form>
    </div>
  );
}
