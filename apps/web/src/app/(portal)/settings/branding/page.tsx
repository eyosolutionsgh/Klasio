'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

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

const DEFAULT_BRAND = '#17513c';

/** A few safe starting points, so a school never has to reach for a colour picker. */
const PRESETS = [
  { value: '#17513c', label: 'Forest' },
  { value: '#1d4ed8', label: 'Royal blue' },
  { value: '#7c2d12', label: 'Terracotta' },
  { value: '#5b21b6', label: 'Plum' },
  { value: '#0f766e', label: 'Teal' },
  { value: '#9a3412', label: 'Amber earth' },
];

const field =
  'w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

export default function BrandingPage() {
  const router = useRouter();
  const [p, setP] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
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

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!p) return;
    setBusy(true);
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
    setBusy(false);
    setError(!res.ok);
    setNote(res.ok ? 'Saved.' : (body.message ?? 'Could not save.'));
    // Chrome is server-rendered from /me, so the new colour and name need a refresh to appear.
    if (res.ok) router.refresh();
  }

  async function uploadLogo(file: File) {
    setBusy(true);
    setNote(null);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/proxy/school/logo', { method: 'POST', body: fd });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setError(!res.ok);
    setNote(res.ok ? 'Logo updated.' : (body.message ?? 'Could not upload that image.'));
    if (res.ok) {
      setLogoStamp(Date.now()); // bust the <img> cache so the new crest shows immediately
      await load();
      router.refresh();
    }
  }

  async function removeLogo() {
    setBusy(true);
    const res = await fetch('/api/proxy/school/logo', { method: 'DELETE' });
    setBusy(false);
    if (res.ok) {
      setNote('Logo removed.');
      setError(false);
      await load();
      router.refresh();
    }
  }

  if (!p) return <p className="text-sm text-oat">Loading…</p>;

  const colour = p.brandColor ?? DEFAULT_BRAND;

  return (
    <div className="max-w-2xl">
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">School profile &amp; branding</h1>
        <p className="text-sm text-oat mt-1.5">
          Your crest, colour and contact details. These appear across the portal, on report cards
          and on receipts.
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
                if (f) uploadLogo(f);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="min-h-11 rounded-lg border border-brand/40 text-brand text-sm font-medium px-4 hover:bg-brand-mist transition disabled:opacity-60"
            >
              {p.hasLogo ? 'Replace crest' : 'Upload crest'}
            </button>
            {p.hasLogo && (
              <button
                onClick={removeLogo}
                disabled={busy}
                className="min-h-11 px-3 text-[13px] text-clay hover:underline underline-offset-2 disabled:opacity-60"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </section>

      <form onSubmit={save} className="card p-6 mt-6 rise rise-3">
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
          Printed on report cards and receipts, and shown to parents in the portal.
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
          <button
            disabled={busy}
            className="min-h-11 rounded-lg bg-brand text-paper text-sm font-medium px-5 hover:bg-brand-deep transition disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          {note && <span className={`text-sm ${error ? 'text-danger' : 'text-leaf'}`}>{note}</span>}
        </div>
      </form>
    </div>
  );
}
