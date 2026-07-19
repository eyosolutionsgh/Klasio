'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useAsyncAction } from '@/components/Button';
import { KeyIcon, LockIcon, PhoneIcon, SaveIcon, UserIcon } from '@/components/icons';

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
  // Failure reasons only — the buttons say when something worked.
  const [error, setError] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  // Not a success note: it explains that this session is about to end, which the button cannot.
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    fetch('/api/proxy/users/me')
      .then((r) => r.json())
      .then((d: Profile) => {
        setMe(d);
        setName(d.name);
        setPhone(d.phone ?? '');
      });
  }, []);

  const saveDetails = useAsyncAction(async () => {
    setError(null);
    const res = await fetch('/api/proxy/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone: phone || undefined }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? 'Could not save.');
      throw new Error('rejected');
    }
    // The name shows in the top bar and sidebar, so refresh the server-rendered chrome.
    router.refresh();
  });

  const changePassword = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    // Read before the first await: React clears `currentTarget` once the handler returns.
    const form = e.currentTarget;
    const data = new FormData(form);
    setPwError(null);
    const res = await fetch('/api/proxy/users/me/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: String(data.get('currentPassword') ?? ''),
        newPassword: String(data.get('newPassword') ?? ''),
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPwError(d.message ?? 'Could not change your password.');
      throw new Error('rejected');
    }
    form.reset();
    /**
     * Changing the password ends every session it had opened — this one included, since the API
     * cannot tell this browser apart from any other. Say so and go to the sign-in page, rather
     * than leaving them on a page whose next click would fail with an expired session.
     */
    setSigningOut(true);
    await fetch('/api/session', { method: 'DELETE' });
    setTimeout(() => router.replace('/login'), 1800);
  });

  if (!me) return <p className="text-sm text-oat">Loading…</p>;

  return (
    <div className="max-w-xl">
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">My profile</h1>
        <p className="text-sm text-oat mt-1.5">
          Your own account details. Your role and access are set by the school&apos;s owner or head.
        </p>
      </div>

      <form onSubmit={saveDetails.run} className="card p-6 mt-6 rise rise-2 space-y-4">
        <h2 className="font-display text-xl">Details</h2>
        <label className="block text-[13px]">
          <span className="block text-oat mb-1">Full name</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
              <UserIcon />
            </span>
            <input
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`${field} pl-10`}
            />
          </div>
        </label>
        <label className="block text-[13px]">
          <span className="block text-oat mb-1">Phone</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
              <PhoneIcon />
            </span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="024 123 4567"
              className={`${field} pl-10`}
            />
          </div>
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
          <Button type="submit" state={saveDetails.state} icon={<SaveIcon />}>
            Save changes
          </Button>
          {error && <span className="text-sm text-danger">{error}</span>}
        </div>
      </form>

      <form onSubmit={changePassword.run} className="card p-6 mt-6 rise rise-3 space-y-4">
        <h2 className="font-display text-xl">Change password</h2>
        <label className="block text-[13px]">
          <span className="block text-oat mb-1">Current password</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
              <LockIcon />
            </span>
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              className={`${field} pl-10`}
            />
          </div>
        </label>
        <label className="block text-[13px]">
          <span className="block text-oat mb-1">New password</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
              <LockIcon />
            </span>
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className={`${field} pl-10`}
            />
          </div>
          <span className="block text-[11px] text-oat mt-1">At least 8 characters.</span>
        </label>
        <div className="flex items-center gap-3">
          {/* "Change" is not a conjugated verb, so the three states are spelled out. */}
          <Button
            type="submit"
            state={changePassword.state}
            variant="secondary"
            icon={<KeyIcon />}
            pendingLabel="Changing…"
            doneLabel="Password changed!"
            failedLabel="Couldn't change"
          >
            Change password
          </Button>
          {pwError && <span className="text-sm text-danger">{pwError}</span>}
          {signingOut && (
            <span className="text-sm text-leaf">
              Signing you out of every device — please sign in again.
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
