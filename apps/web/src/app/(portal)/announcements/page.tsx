'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, useAsyncAction } from '@/components/Button';
import { ChoiceCards } from '@/components/ChoiceCards';
import { AlertIcon, CheckIcon, SendIcon, UploadIcon } from '@/components/icons';

/**
 * Compose once, send everywhere.
 *
 * This screen used to be a title, a textarea and a Post button that wrote a row nobody was told
 * about. A head who wanted families to actually know about Friday's closure wrote it here for the
 * notice board, then wrote it again on the messaging screen for SMS, and by the time both went out
 * they said slightly different things.
 *
 * The two audience questions are asked separately because they always were separate: *which
 * people* (everyone, a class, a level) and *which portals* (guardians, students). Conflating them
 * is how `Announcement.audience` ended up read by two portals and written by nobody.
 */
interface Broadcast {
  id: string;
  title: string;
  body: string;
  channels: string[];
  audienceRoles: string[];
  status: string;
  createdAt: string;
  posts: { platform: string; status: string; permalink: string | null; error: string | null }[];
}

const CHANNELS = [
  { id: 'PORTAL', label: 'Notice board', hint: 'Shows in the guardian and student portals' },
  { id: 'SMS', label: 'SMS', hint: "Texts guardians. Spends the school's credits" },
  { id: 'EMAIL', label: 'Email', hint: 'Guardians with an address on file' },
  { id: 'SOCIAL', label: 'Social', hint: 'Your connected Facebook and Instagram' },
] as const;

const ROLES = [
  { id: 'GUARDIANS', label: 'Guardians' },
  { id: 'STUDENTS', label: 'Students' },
] as const;

/**
 * The server has always resolved five audiences; this offered three, so "everyone on the Adenta
 * bus" and "these nine parents" were reachable only by whoever was writing the request by hand.
 *
 * `ROUTE` is filtered out below when the school has no transport routes to pick from, rather than
 * being hidden behind a tier check here — a school on the right package with no routes entered yet
 * would otherwise be offered an audience that resolves to nobody.
 */
const SCOPES = [
  { value: 'ALL', label: 'Everyone' },
  { value: 'CLASS', label: 'One class' },
  { value: 'LEVEL', label: 'One level' },
  { value: 'ROUTE', label: 'One bus route' },
  { value: 'CUSTOM', label: 'A list I pick' },
] as const;

type Scope = (typeof SCOPES)[number]['value'];

const STATUS_TONE: Record<string, string> = {
  SENT: 'bg-leaf/10 text-leaf',
  PARTIAL: 'bg-clay/10 text-clay',
  FAILED: 'bg-danger/10 text-danger',
  SENDING: 'bg-parchment text-oat',
};

export default function AnnouncementsPage() {
  const [items, setItems] = useState<Broadcast[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [channels, setChannels] = useState<string[]>(['PORTAL']);
  const [roles, setRoles] = useState<string[]>(['GUARDIANS']);
  const [scope, setScope] = useState<Scope>('ALL');
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [levels, setLevels] = useState<{ id: string; name: string }[]>([]);
  const [classId, setClassId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [routes, setRoutes] = useState<{ id: string; name: string }[]>([]);
  const [routeId, setRouteId] = useState('');
  /** Free text, one number per line or comma-separated — normalised server-side. */
  const [recipients, setRecipients] = useState('');
  const [media, setMedia] = useState<{ id: string; filename: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ channel: string; ok: boolean; detail: string }[]>([]);

  const load = useCallback(async () => {
    const res = await fetch('/api/proxy/broadcasts?perPage=20');
    if (res.ok) setItems((await res.json()).rows ?? []);
  }, []);

  useEffect(() => {
    load();
    fetch('/api/proxy/school/structure')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setClasses(d.classes ?? []);
        setLevels(d.levels ?? []);
      })
      .catch(() => {});
    /*
      Transport is entitlement- and permission-gated, so this 403s for most schools. A failure
      here means "no routes to offer", not an error worth showing: the audience simply is not
      one this school has.
    */
    fetch('/api/proxy/transport/routes')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRoutes(Array.isArray(d) ? d : (d?.rows ?? [])))
      .catch(() => {});
  }, [load]);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const upload = useAsyncAction(async (file: File) => {
    const form = new FormData();
    form.set('file', file);
    const res = await fetch('/api/proxy/broadcasts/media', { method: 'POST', body: form });
    if (!res.ok) throw new Error('rejected');
    const m = await res.json();
    setMedia((prev) => [...prev, { id: m.id, filename: m.filename }]);
  });

  const send = useAsyncAction(async () => {
    setError(null);
    setOutcome([]);
    const res = await fetch('/api/proxy/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        body: body.trim(),
        audienceScope: scope,
        classId: scope === 'CLASS' ? classId : undefined,
        levelId: scope === 'LEVEL' ? levelId : undefined,
        routeId: scope === 'ROUTE' ? routeId : undefined,
        // Split on anything that is not part of a number, so a pasted column, a comma-separated
        // line and a WhatsApp-style list all arrive the same way.
        recipients:
          scope === 'CUSTOM'
            ? recipients
                .split(/[\s,;]+/)
                .map((x) => x.trim())
                .filter(Boolean)
            : undefined,
        audienceRoles: roles,
        channels,
        mediaIds: media.map((m) => m.id),
        /*
          Generated here, once per composed message, and this is the entire point of it: the server
          mints SMS batch ids from the clock, so two clicks a second apart used to be two sends to
          the same two thousand guardians. The second submit now loses to a unique constraint.
        */
        idempotencyKey:
          globalThis.crypto?.randomUUID?.() ?? `bc-${Date.now()}-${Math.random().toString(36)}`,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message ?? 'Could not send that.');
      throw new Error('rejected');
    }
    setOutcome(data.results ?? []);
    setTitle('');
    setBody('');
    setMedia([]);
    load();
  });

  const needsMedia = channels.includes('SOCIAL') && media.length === 0;
  const smsChars = title.length + body.length + 2;

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Announcements</h1>
        <p className="text-sm text-oat mt-1.5">
          Write once. Send it to the portals, by text, by email, and to your social pages.
        </p>
      </div>

      <form onSubmit={send.run} className="card p-6 mt-6 rise rise-2 space-y-5 max-w-3xl">
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-oat">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            minLength={3}
            maxLength={140}
            placeholder="Mid-term break begins Friday"
            className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>

        <label className="block">
          <span className="text-xs uppercase tracking-widest text-oat">Message</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            minLength={3}
            rows={5}
            placeholder="School closes at 12.30pm on Friday. Classes resume Monday 3 August."
            className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
          {/*
            Shown only when SMS is selected, because for the other three channels the number is
            meaningless — and for SMS it is not a length, it is the bill.
          */}
          {channels.includes('SMS') && (
            <span className="mt-1 block text-xs text-oat tabular">
              {smsChars} characters · {Math.max(1, Math.ceil(smsChars / 160))} SMS per guardian
            </span>
          )}
        </label>

        <fieldset>
          <legend className="text-xs uppercase tracking-widest text-oat">Send it by</legend>
          <div className="mt-2 grid sm:grid-cols-2 gap-2">
            {CHANNELS.map((c) => (
              <label
                key={c.id}
                className={`flex gap-2.5 items-start rounded-lg border px-3 py-2.5 cursor-pointer transition ${
                  channels.includes(c.id)
                    ? 'border-brand bg-brand-mist/40'
                    : 'border-mist bg-white hover:bg-parchment/50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={channels.includes(c.id)}
                  onChange={() => toggle(channels, setChannels, c.id)}
                  className="mt-0.5 accent-[var(--color-brand)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{c.label}</span>
                  <span className="block text-xs text-oat leading-snug">{c.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid sm:grid-cols-2 gap-5">
          <ChoiceCards
            legend="Which people"
            name="scope"
            value={scope}
            onChange={setScope}
            options={SCOPES.filter((s) => s.value !== 'ROUTE' || routes.length > 0)}
          />
          <fieldset>
            <legend className="text-xs uppercase tracking-widest text-oat">Which portals</legend>
            <div className="mt-2 flex gap-2">
              {ROLES.map((r) => (
                <label
                  key={r.id}
                  className={`flex gap-2 items-center rounded-lg border px-3 py-2 cursor-pointer text-sm transition ${
                    roles.includes(r.id)
                      ? 'border-brand bg-brand-mist/40'
                      : 'border-mist bg-white hover:bg-parchment/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={roles.includes(r.id)}
                    onChange={() => toggle(roles, setRoles, r.id)}
                    className="accent-[var(--color-brand)]"
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {scope === 'CLASS' && (
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-oat">Class</span>
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              required
              className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm"
            >
              <option value="">Choose a class…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {scope === 'LEVEL' && (
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-oat">Level</span>
            <select
              value={levelId}
              onChange={(e) => setLevelId(e.target.value)}
              required
              className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm"
            >
              <option value="">Choose a level…</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {scope === 'ROUTE' && (
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-oat">Bus route</span>
            <select
              value={routeId}
              onChange={(e) => setRouteId(e.target.value)}
              required
              className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm"
            >
              <option value="">Choose a route…</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-oat">
              Reaches the guardians of every child riding this route.
            </span>
          </label>
        )}
        {scope === 'CUSTOM' && (
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-oat">Numbers</span>
            <textarea
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              required
              rows={3}
              placeholder="024 123 4567, 0201234567&#10;+233 27 765 4321"
              className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
            {/*
              Said plainly rather than discovered: a picked list is a list of phone numbers, so
              there is nobody to show a notice to and no address to email. Choosing it with the
              other channels ticked would otherwise look like it had reached four places.
            */}
            <span className="mt-1 block text-xs text-oat">
              {
                recipients.split(/[\s,;]+/).filter(Boolean).length
              }{' '}
              number(s), one per line or comma-separated. A picked list goes by{' '}
              <span className="text-ink">SMS only</span> — there is no portal account or email
              address behind a bare number.
            </span>
          </label>
        )}

        <div>
          <span className="text-xs uppercase tracking-widest text-oat">Picture</span>
          <div className="mt-1.5 flex items-center gap-3 flex-wrap">
            <label className="inline-flex items-center gap-2 rounded-lg border border-mist bg-white px-3 py-2 text-sm cursor-pointer hover:bg-parchment/50">
              <UploadIcon aria-hidden />
              {upload.state === 'pending' ? 'Uploading…' : 'Add a picture'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload.run(f);
                  e.target.value = '';
                }}
              />
            </label>
            {media.map((m) => (
              <span key={m.id} className="text-xs text-oat rounded-full bg-parchment px-2.5 py-1">
                {m.filename}
              </span>
            ))}
          </div>
          {/*
            Instagram has no text-only post. Said here, while the message is still being written,
            rather than surfaced afterwards as a Graph API error nobody outside Meta can read.
          */}
          {needsMedia && (
            <p className="mt-2 text-xs text-clay flex gap-1.5">
              <AlertIcon aria-hidden />
              Instagram needs a picture — without one, only Facebook will get this.
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger flex gap-2">
            <AlertIcon aria-hidden />
            <span>{error}</span>
          </p>
        )}

        {/*
          Reported per channel, because they genuinely differ: the notice board can succeed while
          SMS runs out of credit halfway. A single "Sent!" over the top of that would be a lie
          about three quarters of it.
        */}
        {outcome.length > 0 && (
          <ul className="rounded-lg border border-mist bg-parchment/40 divide-y divide-mist text-sm">
            {outcome.map((r) => (
              <li key={r.channel} className="flex gap-2.5 px-3 py-2">
                <span className={r.ok ? 'text-leaf' : 'text-danger'}>
                  {r.ok ? <CheckIcon aria-hidden /> : <AlertIcon aria-hidden />}
                </span>
                <span className="font-medium w-24 shrink-0">{r.channel}</span>
                <span className="text-oat">{r.detail}</span>
              </li>
            ))}
          </ul>
        )}

        <Button
          type="submit"
          state={send.state}
          disabled={channels.length === 0 || roles.length === 0}
          pendingLabel="Sending…"
          doneLabel="Sent!"
          failedLabel="Couldn't send"
          icon={<SendIcon aria-hidden />}
        >
          Send
        </Button>
      </form>

      <div className="card mt-6 rise rise-3 overflow-x-auto table-stack-wrap max-w-3xl">
        <table className="w-full text-sm table-stack">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <th className="px-5 py-3 font-medium">Message</th>
              <th className="px-5 py-3 font-medium">Sent by</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((b) => (
              <tr key={b.id} className="border-b border-mist/60 last:border-0 align-top">
                <td data-label="Message" className="px-5 py-3">
                  <span className="block font-medium">{b.title}</span>
                  <span className="block text-xs text-oat line-clamp-2 mt-0.5">{b.body}</span>
                </td>
                <td data-label="Sent by" className="px-5 py-3 text-oat text-xs">
                  {b.channels.join(', ')}
                  {b.posts.length > 0 && (
                    <span className="block mt-1">
                      {b.posts.map((p) => (
                        <span key={p.platform} className="block">
                          {p.platform}: {p.status.toLowerCase()}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                <td data-label="Status" className="px-5 py-3">
                  <span
                    className={`text-[11px] uppercase tracking-wider rounded-full px-2 py-0.5 ${
                      STATUS_TONE[b.status] ?? 'bg-parchment text-oat'
                    }`}
                  >
                    {b.status}
                  </span>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-10 text-center text-oat">
                  Nothing sent yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
