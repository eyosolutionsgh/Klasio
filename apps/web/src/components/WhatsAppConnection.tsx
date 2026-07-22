'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useAsyncAction } from './Button';
import { AlertIcon, KeyIcon, PhoneIcon } from './icons';

/**
 * Connecting the school's own WhatsApp number.
 *
 * This screen used to be unusable for any school that had not had someone edit
 * `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_TOKEN` on the box and restart it — which, on a product
 * where every school runs its own server, is a support call rather than configuration. Until that
 * happened the page sat permanently empty, which is a fair reading of "useless".
 *
 * Token paste rather than "Log in with Meta", for the same reason the social accounts screen does
 * it: an OAuth redirect has to be registered in advance, and every school has its own address.
 */

interface Config {
  connected: boolean;
  phoneNumberId: string | null;
  displayNumber: string | null;
  wabaId: string | null;
  lastSentAt: string | null;
  connectedAt: string | null;
  /** Replies are going out, but from whatever number the box itself was set up with. */
  usingBoxDefault: boolean;
  webhookUrl: string;
}

const field =
  'w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

export default function WhatsAppConnection() {
  const router = useRouter();
  const [config, setConfig] = useState<Config | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [token, setToken] = useState('');
  const [displayNumber, setDisplayNumber] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/proxy/whatsapp/config');
    if (res.ok) setConfig(await res.json());
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = useAsyncAction(async () => {
    setError(null);
    const res = await fetch('/api/proxy/whatsapp/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumberId: phoneNumberId.trim(),
        token: token.trim(),
        displayNumber,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message ?? 'Those details were not accepted.');
      throw new Error('rejected');
    }
    setConfig(data);
    setToken('');
    setOpen(false);
    // The conversation list is server-rendered, and connecting is what makes it possible to fill.
    router.refresh();
  });

  const disconnect = useAsyncAction(async () => {
    const res = await fetch('/api/proxy/whatsapp/config', { method: 'DELETE' });
    if (!res.ok) throw new Error('rejected');
    setConfig(await res.json());
    router.refresh();
  });

  if (!config) return null;

  return (
    <section className="card p-5 mt-6 rise rise-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl flex items-center gap-2">
            <PhoneIcon aria-hidden />
            {config.connected ? 'Connected' : 'Not connected yet'}
          </h2>
          <p className="text-[13px] text-oat mt-1.5 max-w-prose">
            {config.connected ? (
              <>
                Replies go out from{' '}
                <span className="text-ink">{config.displayNumber ?? 'your WhatsApp number'}</span>
                {config.lastSentAt
                  ? ` — last used on ${new Date(config.lastSentAt).toLocaleDateString('en-GH', { day: 'numeric', month: 'long' })}.`
                  : ' — nothing sent from it yet.'}
              </>
            ) : config.usingBoxDefault ? (
              // Not the same as "not connected": messages really do send, just not from a number
              // this school chose. Saying "not connected" here would be a lie with consequences.
              'This server has a WhatsApp number set up on it, and replies will go out from that. Connect your own school number to send from it instead.'
            ) : (
              'Families cannot reach the school on WhatsApp until its number is connected here. Everything else — SMS, email, the notice board — works without it.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)}>
            {config.connected ? 'Replace the number' : 'Connect a number'}
          </Button>
          {config.connected && (
            <Button
              variant="danger"
              size="sm"
              state={disconnect.state}
              onClick={disconnect.run}
              pendingLabel="Disconnecting…"
              doneLabel="Disconnected"
              failedLabel="Couldn't disconnect"
            >
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {open && (
        <form onSubmit={save.run} className="mt-5 border-t border-mist pt-5 space-y-4 max-w-xl">
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-oat">Phone number ID</span>
            <input
              required
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="123456789012345"
              className={`${field} mt-1.5 tabular`}
            />
            {/* The mistake this field invites, named before it is made. */}
            <span className="mt-1 block text-xs text-oat">
              From Meta&apos;s WhatsApp settings — a long number Meta gives you, not the school
              number itself.
            </span>
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-widest text-oat">
              The number, as families see it
            </span>
            <input
              value={displayNumber}
              onChange={(e) => setDisplayNumber(e.target.value)}
              placeholder="+233 24 123 4567"
              className={`${field} mt-1.5`}
            />
            <span className="mt-1 block text-xs text-oat">
              Optional, and never used to send — only so this screen can say which number is
              connected.
            </span>
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-widest text-oat">Access token</span>
            <textarea
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder="EAAG…"
              className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2 text-xs font-mono break-all outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
            <span className="mt-1 block text-xs text-oat">
              Stored encrypted, and never shown again — replace it here if it is ever rotated.
            </span>
          </label>

          <div>
            <span className="text-xs uppercase tracking-widest text-oat">
              Webhook address for Meta
            </span>
            {/* Read-only: it is ours to state, not theirs to invent, and a typo here is a silent
                failure — messages arrive nowhere and nothing says so. */}
            <p className="mt-1.5 rounded-lg bg-parchment px-3 py-2 text-xs font-mono break-all select-all">
              {config.webhookUrl || '(set PUBLIC_BASE_URL on this server to show the address)'}
            </p>
            <span className="mt-1 block text-xs text-oat">
              Paste this into Meta as the callback address, so a family&apos;s message reaches this
              school.
            </span>
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger flex gap-2">
              <AlertIcon aria-hidden />
              {error}
            </p>
          )}

          <Button
            type="submit"
            state={save.state}
            icon={<KeyIcon />}
            pendingLabel="Connecting…"
            doneLabel="Connected!"
            failedLabel="Couldn't connect"
          >
            Save connection
          </Button>
        </form>
      )}
    </section>
  );
}
