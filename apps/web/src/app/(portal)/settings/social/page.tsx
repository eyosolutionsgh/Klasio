'use client';

import { useCallback, useEffect, useState } from 'react';
import RowMenu from '@/components/RowMenu';
import { Button, useAsyncAction } from '@/components/Button';
import { AlertIcon, KeyIcon } from '@/components/icons';

interface Account {
  id: string;
  platform: string;
  externalId: string;
  displayName: string;
  status: string;
  hasToken: boolean;
  tokenExpiresAt: string | null;
}

interface Platform {
  platform: string;
  label: string;
  enabled: boolean;
  note?: string;
}

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'bg-leaf/10 text-leaf',
  EXPIRING: 'bg-clay/10 text-clay',
  EXPIRED: 'bg-danger/10 text-danger',
  REVOKED: 'bg-danger/10 text-danger',
};

export default function SocialPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [platform, setPlatform] = useState('FACEBOOK_PAGE');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<string[]>([]);

  const load = useCallback(async () => {
    const [a, p] = await Promise.all([
      fetch('/api/proxy/social/accounts'),
      fetch('/api/proxy/social/platforms'),
    ]);
    if (a.ok) setAccounts(await a.json());
    if (p.ok) setPlatforms(await p.json());
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const connect = useAsyncAction(async () => {
    setError(null);
    setConnected([]);
    const res = await fetch('/api/proxy/social/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, token: token.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message ?? 'That token was not accepted.');
      throw new Error('rejected');
    }
    setConnected(data.connected ?? []);
    setToken('');
    load();
  });

  async function disconnect(id: string) {
    const res = await fetch(`/api/proxy/social/accounts/${id}`, { method: 'DELETE' });
    // Thrown rather than ignored, so a refusal reaches the menu instead of looking like success.
    if (!res.ok) throw new Error('rejected');
    load();
  }

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Social accounts</h1>
        <p className="text-sm text-oat mt-1.5">
          Connect the school&apos;s own pages, and an announcement can go out to them at the same
          time as the text and the email.
        </p>
      </div>

      <div className="card mt-6 rise rise-2 overflow-x-auto table-stack-wrap max-w-2xl">
        <table className="w-full text-sm table-stack">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <th className="px-5 py-3 font-medium">Account</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-b border-mist/60 last:border-0">
                <td data-label="Account" className="px-5 py-3">
                  <span className="block font-medium">{a.displayName}</span>
                  <span className="block text-xs text-oat">{a.platform.replace('_', ' ')}</span>
                </td>
                <td data-label="Status" className="px-5 py-3">
                  <span
                    className={`text-[11px] uppercase tracking-wider rounded-full px-2 py-0.5 ${
                      STATUS_TONE[a.status] ?? 'bg-parchment text-oat'
                    }`}
                  >
                    {a.status}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <div className="flex justify-end">
                    <RowMenu
                      label={a.displayName}
                      actions={[
                        {
                          label: 'Disconnect this account',
                          danger: true,
                          confirm: `Disconnect ${a.displayName}? Nothing already posted is removed, but the school can no longer post to it until it is reconnected.`,
                          confirmLabel: 'Yes, disconnect',
                          pendingLabel: 'Disconnecting…',
                          doneLabel: 'Disconnected',
                          onSelect: () => disconnect(a.id),
                        },
                      ]}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-10 text-center text-oat">
                  No accounts connected yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={connect.run} className="card p-6 mt-6 rise rise-3 max-w-2xl space-y-4">
        <div>
          <h2 className="font-display text-xl flex items-center gap-2">
            <KeyIcon aria-hidden />
            Connect an account
          </h2>
          {/*
            Token paste rather than a "Log in with Facebook" button, and that is deliberate.
            Meta requires a redirect address registered in advance, and every school runs on its
            own server with its own address — so there is no single one to register, and building a
            shared one would mean routing every school's credentials through us.
          */}
          <p className="text-sm text-oat mt-1.5">
            Paste a long-lived access token from Meta. We read the page name, the linked Instagram
            account and the expiry back from Meta itself — you do not need to look any of them up.
          </p>
        </div>

        <label className="block">
          <span className="text-xs uppercase tracking-widest text-oat">Platform</span>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm"
          >
            {platforms.map((p) => (
              <option key={p.platform} value={p.platform} disabled={!p.enabled}>
                {p.label}
                {!p.enabled && p.note ? ` — ${p.note}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs uppercase tracking-widest text-oat">Access token</span>
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            rows={3}
            spellCheck={false}
            required
            placeholder="EAAG…"
            className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2 text-xs font-mono break-all outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
          <span className="mt-1 block text-xs text-oat">
            Stored encrypted, and never shown again. Connecting a Facebook Page also connects the
            Instagram account linked to it.
          </span>
        </label>

        {error && (
          <p role="alert" className="text-sm text-danger flex gap-2">
            <AlertIcon aria-hidden />
            <span>{error}</span>
          </p>
        )}
        {connected.length > 0 && (
          <p className="text-sm text-leaf">Connected {connected.join(' and ')}.</p>
        )}

        <Button
          type="submit"
          state={connect.state}
          disabled={!token.trim()}
          pendingLabel="Checking…"
          doneLabel="Connected!"
          failedLabel="Not accepted"
          icon={<KeyIcon aria-hidden />}
        >
          Connect
        </Button>
      </form>
    </div>
  );
}
