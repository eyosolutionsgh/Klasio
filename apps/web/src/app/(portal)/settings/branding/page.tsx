'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useAsyncAction } from '@/components/Button';
import { SaveIcon, TrashIcon, UploadIcon } from '@/components/icons';
import SignInPhotos from '@/components/SignInPhotos';

interface Profile {
  name: string;
  motto: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  region: string | null;
  website: string | null;
  brandColor: string | null;
  hasLogo: boolean;
}

const DEFAULT_BRAND = '#002b5b';

/** A few safe starting points, so a school never has to reach for a colour picker.
 *  All are dark enough to carry `text-paper` at 4.5:1 — the portal paints them under white
 *  labels (buttons, the sidebar), so a light pick here would be unreadable. */
const PRESETS = [
  { value: '#002b5b', label: 'Klasio navy' },
  { value: '#17513c', label: 'Forest' },
  { value: '#00595c', label: 'Teal' },
  { value: '#7c2d12', label: 'Terracotta' },
  { value: '#5b21b6', label: 'Plum' },
  { value: '#9a3412', label: 'Amber earth' },
];

const field =
  'w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

export default function BrandingPage() {
  const router = useRouter();
  const [p, setP] = useState<Profile | null>(null);
  // Only ever a failure now. Success is narrated by the button itself, so a "Saved." beside a
  // button already reading "Saved!" was just the same word twice.
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [logoStamp, setLogoStamp] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/proxy/school/profile');
    if (res.ok) setP(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    setP((cur) => (cur ? { ...cur, [key]: value } : cur));
  }

  const saveAction = useAsyncAction(async () => {
    if (!p) return;
    setNote(null);
    const res = await fetch('/api/proxy/school/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: p.name,
        motto: p.motto ?? '',
        address: p.address ?? '',
        phone: p.phone ?? '',
        email: p.email || undefined,
        region: p.region ?? '',
        website: p.website || undefined,
        brandColor: p.brandColor ?? undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setError(!res.ok);
    if (!res.ok) {
      setNote(body.message ?? 'Could not save.');
      // Thrown so the button settles on "Couldn't save" rather than a tick — the request came
      // back, but the school's profile did not change.
      throw new Error(body.message ?? 'save rejected');
    }
    // Chrome is server-rendered from /me, so the new colour and name need a refresh to appear.
    router.refresh();
  });

  const upload = useAsyncAction(async (file: File) => {
    setNote(null);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/proxy/school/logo', { method: 'POST', body: fd });
    const body = await res.json().catch(() => ({}));
    setError(!res.ok);
    if (!res.ok) {
      // The button can only say "Couldn't upload"; the server's reason is the useful part —
      // which format, which size limit — so that one stays on screen.
      setNote(body.message ?? 'Could not upload that image.');
      throw new Error('upload rejected');
    }
    setLogoStamp(Date.now()); // bust the <img> cache so the new crest shows immediately
    await load();
    router.refresh();
  });

  const removeCrest = useAsyncAction(async () => {
    const res = await fetch('/api/proxy/school/logo', { method: 'DELETE' });
    if (!res.ok) {
      setError(true);
      setNote('Could not remove the crest.');
      throw new Error('remove rejected');
    }
    setError(false);
    setNote(null);
    await load();
    router.refresh();
  });

  if (!p) return <p className="text-sm text-oat">Loading…</p>;

  const colour = p.brandColor ?? DEFAULT_BRAND;

  return (
    <div className="max-w-2xl">
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">School profile &amp; branding</h1>
        <p className="text-sm text-oat mt-1.5">
          Your crest, colour and contact details. These appear across the portal, on terminal
          reports and on receipts.
        </p>
      </div>

      <section className="card p-6 mt-6 rise rise-2">
        <h2 className="font-display text-xl">Crest</h2>
        <p className="text-sm text-oat mt-1.5">
          Shown in the top bar, the sidebar and on printed documents. A square image works best —
          JPEG, PNG or WebP up to 8MB.
        </p>
        <div className="mt-4 flex items-center gap-5 flex-wrap">
          <div className="w-20 h-20 rounded-lg border border-mist bg-parchment/60 grid place-items-center overflow-hidden shrink-0">
            {p.hasLogo ? (
              <img
                src={`/api/proxy/school/logo?v=${logoStamp}`}
                alt="School crest"
                className="w-full h-full object-contain"
              />
            ) : (
              <span className="text-[11px] text-oat text-center px-2">No crest</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.run(f);
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => fileRef.current?.click()}
              state={upload.state}
              icon={<UploadIcon />}
              pendingLabel="Uploading…"
              doneLabel="Uploaded!"
              failedLabel="Couldn't upload"
            >
              {p.hasLogo ? 'Replace crest' : 'Upload crest'}
            </Button>
            {p.hasLogo && (
              <Button
                type="button"
                variant="ghost"
                onClick={removeCrest.run}
                state={removeCrest.state}
                icon={<TrashIcon />}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      </section>

      <form onSubmit={saveAction.run} className="card p-6 mt-6 rise rise-3">
        <h2 className="font-display text-xl">Colour</h2>
        <p className="text-sm text-oat mt-1.5">
          Used for the sidebar, top bar and buttons. Text and page backgrounds stay as they are, so
          the portal is readable whichever colour you pick.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => set('brandColor', preset.value)}
              aria-label={preset.label}
              aria-pressed={colour.toLowerCase() === preset.value}
              title={preset.label}
              className={`w-11 h-11 rounded-lg border-2 transition ${
                colour.toLowerCase() === preset.value
                  ? 'border-ink scale-105'
                  : 'border-mist hover:border-oat'
              }`}
              style={{ background: preset.value }}
            />
          ))}
          <label className="flex items-center gap-2 text-[13px] ml-1">
            <input
              type="color"
              value={colour}
              onChange={(e) => set('brandColor', e.target.value)}
              className="w-11 h-11 rounded-lg border border-mist bg-white p-1 cursor-pointer"
              aria-label="Custom colour"
            />
            <span className="tabular text-oat">{colour}</span>
          </label>
        </div>

        <div
          className="brand-scope mt-5 rounded-lg overflow-hidden border border-mist"
          style={{ ['--brand' as string]: colour }}
        >
          <div className="bg-brand-deep text-paper px-4 py-3 text-[13px]">
            Preview — sidebar and top bar
          </div>
          <div className="bg-white px-4 py-3 flex items-center gap-3">
            <span className="min-h-11 grid place-items-center rounded-lg bg-brand text-paper text-sm font-medium px-4">
              Primary button
            </span>
            <span className="text-[11px] uppercase tracking-widest font-medium text-brand bg-brand-mist rounded-full px-3 py-1">
              Badge
            </span>
          </div>
        </div>

        <h2 className="font-display text-xl mt-8">Contact details</h2>
        <p className="text-sm text-oat mt-1.5">
          Printed on terminal reports and receipts, and shown to guardians in the portal.
        </p>
        <div className="mt-4 grid sm:grid-cols-2 gap-4">
          <label className="block text-[13px] sm:col-span-2">
            <span className="block text-oat mb-1">School name</span>
            <input
              required
              minLength={2}
              value={p.name}
              onChange={(e) => set('name', e.target.value)}
              className={field}
            />
          </label>
          <label className="block text-[13px] sm:col-span-2">
            <span className="block text-oat mb-1">Motto</span>
            <input
              value={p.motto ?? ''}
              onChange={(e) => set('motto', e.target.value)}
              placeholder="Knowledge · Discipline · Service"
              className={field}
            />
          </label>
          <label className="block text-[13px] sm:col-span-2">
            <span className="block text-oat mb-1">Address</span>
            <input
              value={p.address ?? ''}
              onChange={(e) => set('address', e.target.value)}
              placeholder="Adjiringanor Road, East Legon, Accra"
              className={field}
            />
          </label>
          <label className="block text-[13px]">
            <span className="block text-oat mb-1">Region</span>
            <input
              value={p.region ?? ''}
              onChange={(e) => set('region', e.target.value)}
              placeholder="Greater Accra"
              className={field}
            />
          </label>
          <label className="block text-[13px]">
            <span className="block text-oat mb-1">Phone</span>
            <input
              type="tel"
              inputMode="tel"
              value={p.phone ?? ''}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="+233 24 000 0000"
              className={field}
            />
          </label>
          <label className="block text-[13px]">
            <span className="block text-oat mb-1">Email</span>
            <input
              type="email"
              value={p.email ?? ''}
              onChange={(e) => set('email', e.target.value)}
              placeholder="info@school.edu.gh"
              className={field}
            />
          </label>
          <label className="block text-[13px]">
            <span className="block text-oat mb-1">Website</span>
            <input
              value={p.website ?? ''}
              onChange={(e) => set('website', e.target.value)}
              placeholder="www.school.edu.gh"
              className={field}
            />
          </label>
        </div>

        <div className="flex items-center gap-3 mt-6">
          <Button type="submit" state={saveAction.state} icon={<SaveIcon />}>
            Save changes
          </Button>
          {error && note && <span className="text-sm text-danger">{note}</span>}
        </div>
      </form>

      {/*
        Outside the form on purpose: a picture upload takes effect the moment it succeeds, so
        putting it inside something with a Save button would promise a save that had already
        happened.
      */}
      <SignInPhotos />
    </div>
  );
}
