'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Profile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
}

const field =
  'w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

export default function ProfilePage() {
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pwNote, setPwNote] = useState<string | null>(null);
  const [pwError, setPwError] = useState(false);

  useEffect(() => {
    fetch('/api/proxy/users/me')
      .then((r) => r.json())
      .then((d: Profile) => {
        setMe(d);
        setName(d.name);
        setPhone(d.phone ?? '');
      });
  }, []);

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    const res = await fetch('/api/proxy/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone: phone || undefined }),
    });
    setBusy(false);
    if (res.ok) {
      setNote('Saved.');
      // The name shows in the top bar and sidebar, so refresh the server-rendered chrome.
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setNote(d.message ?? 'Could not save.');
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    setBusy(true);
    setPwNote(null);
    const res = await fetch('/api/proxy/users/me/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: String(data.get('currentPassword') ?? ''),
        newPassword: String(data.get('newPassword') ?? ''),
      }),
    });
    setBusy(false);
    const d = await res.json().catch(() => ({}));
    setPwError(!res.ok);
    setPwNote(res.ok ? 'Password changed.' : (d.message ?? 'Could not change your password.'));
    if (res.ok) form.reset();
  }

  if (!me) return <p className="text-sm text-oat">Loading…</p>;

  return (
    <div className="max-w-xl">
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">My profile</h1>
        <p className="text-sm text-oat mt-1.5">
          Your own account details. Your role and access are set by the school&apos;s owner or head.
        </p>
      </div>

      <form onSubmit={saveDetails} className="card p-6 mt-6 rise rise-2 space-y-4">
        <h2 className="font-display text-xl">Details</h2>
        <label className="block text-[13px]">
          <span className="block text-oat mb-1">Full name</span>
          <input
            required
            minLength={2}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={field}
          />
        </label>
        <label className="block text-[13px]">
          <span className="block text-oat mb-1">Phone</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="024 123 4567"
            className={field}
          />
        </label>
        <div className="grid sm:grid-cols-2 gap-4 pt-1">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-oat">Email</p>
            <p className="text-sm mt-0.5">{me.email}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-oat">Role</p>
            <p className="text-sm mt-0.5">{me.role.toLowerCase().replace('_', ' ')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            disabled={busy}
            className="min-h-11 rounded-lg bg-brand text-paper text-sm font-medium px-5 hover:bg-brand-deep transition disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          {note && <span className="text-sm text-oat">{note}</span>}
        </div>
      </form>

      <form onSubmit={changePassword} className="card p-6 mt-6 rise rise-3 space-y-4">
        <h2 className="font-display text-xl">Change password</h2>
        <label className="block text-[13px]">
          <span className="block text-oat mb-1">Current password</span>
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            className={field}
          />
        </label>
        <label className="block text-[13px]">
          <span className="block text-oat mb-1">New password</span>
          <input
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className={field}
          />
          <span className="block text-[11px] text-oat mt-1">At least 8 characters.</span>
        </label>
        <div className="flex items-center gap-3">
          <button
            disabled={busy}
            className="min-h-11 rounded-lg border border-brand/40 text-brand text-sm font-medium px-5 hover:bg-brand-mist transition disabled:opacity-60"
          >
            Change password
          </button>
          {pwNote && (
            <span className={`text-sm ${pwError ? 'text-danger' : 'text-leaf'}`}>{pwNote}</span>
          )}
        </div>
      </form>
    </div>
  );
}
