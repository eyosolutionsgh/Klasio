'use client';

import { useEffect, useState } from 'react';

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

export default function GatewaysPage() {
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [provider, setProvider] = useState<'PAYSTACK' | 'HUBTEL'>('PAYSTACK');
  const [mode, setMode] = useState<'TEST' | 'LIVE'>('TEST');
  const [secret, setSecret] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [merchantNumber, setMerchantNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/proxy/payments/gateway');
    if (res.ok) setGateways(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
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
    setBusy(false);
    if (res.ok) {
      setMessage(`${provider} connected in ${mode} mode.`);
      setSecret('');
      load();
    } else {
      setMessage(data.message ?? 'Could not save gateway credentials.');
    }
  }

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Payment gateways</h1>
        <p className="text-sm text-oat mt-1.5">
          Connect your school&apos;s own Hubtel or Paystack account — fees settle directly to you.
          Keys are encrypted before they are stored and are never shown again.
        </p>
      </div>

      <div className="card mt-6 overflow-x-auto rise rise-2">
        <table className="w-full text-sm">
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
                <td className="px-5 py-3 font-medium">{g.provider}</td>
                <td className="px-5 py-3">
                  <span
                    className={`text-[11px] uppercase tracking-wider rounded-full px-2 py-0.5 ${g.mode === 'LIVE' ? 'bg-leaf/10 text-leaf' : 'bg-parchment text-oat'}`}
                  >
                    {g.mode}
                  </span>
                </td>
                <td className="px-5 py-3 text-oat tabular text-xs">
                  {g.publicKey ?? g.merchantNumber ?? '—'}
                </td>
                <td className="px-5 py-3 text-oat">{g.hasSecret ? 'stored ✓' : '—'}</td>
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

      <form onSubmit={connect} className="card p-6 mt-6 rise rise-3 max-w-xl space-y-4">
        <h2 className="font-display text-xl">Connect a gateway</h2>
        <div className="flex gap-2">
          {(['PAYSTACK', 'HUBTEL'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProvider(p)}
              className={`text-[13px] rounded-full px-3.5 py-1.5 border transition ${provider === p ? 'bg-forest text-paper border-forest' : 'border-mist bg-white hover:border-forest'}`}
            >
              {p}
            </button>
          ))}
          <span className="flex-1" />
          {(['TEST', 'LIVE'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`text-[13px] rounded-full px-3.5 py-1.5 border transition ${mode === m ? 'bg-ink text-paper border-ink' : 'border-mist bg-white hover:border-ink'}`}
            >
              {m}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="secret">
            {provider === 'PAYSTACK' ? 'Secret key' : 'Client secret'}
          </label>
          <input
            id="secret"
            type="password"
            required
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={provider === 'PAYSTACK' ? 'sk_live_…' : 'client secret'}
            className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/15"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="pk">
            {provider === 'PAYSTACK' ? 'Public key' : 'Client ID'}
          </label>
          <input
            id="pk"
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
            className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-forest"
          />
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
              className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-forest"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !secret}
          className="rounded-lg bg-forest text-paper text-sm font-medium px-5 py-2.5 hover:bg-forest-deep transition disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Connect gateway'}
        </button>
        {message && <p className="text-sm text-forest">{message}</p>}
      </form>
    </div>
  );
}
