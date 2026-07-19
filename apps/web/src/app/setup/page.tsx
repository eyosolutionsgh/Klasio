'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/AuthShell';
import { AuthButton, AuthError, AuthField, AuthFieldGroup } from '@/components/AuthField';
import { useAsyncAction } from '@/components/Button';
import { KeyIcon, LockIcon, MailIcon, UserIcon } from '@/components/icons';

/**
 * First run. Creates the school and its owner, then drops them straight into the portal.
 *
 * The page exists at all because there is no vendor console any more: nobody else can create the
 * school on this server. It closes permanently the moment it succeeds — the API refuses a second
 * setup on a row count — so this is also the only chance to get the school's name right without a
 * support call.
 */
export default function SetupPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [alreadySetUp, setAlreadySetUp] = useState(false);

  const [schoolName, setSchoolName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [licence, setLicence] = useState('');
  const [error, setError] = useState<string | null>(null);

  // A server that is already set up must not show this form at all. The API would refuse anyway,
  // but a form that can only fail is a worse answer than saying so.
  useEffect(() => {
    fetch('/api/setup')
      .then((r) => r.json())
      .then((d) => setAlreadySetUp(!d.needsSetup))
      .catch(() => setAlreadySetUp(false))
      .finally(() => setChecking(false));
  }, []);

  const submit = useAsyncAction(async () => {
    setError(null);
    const res = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schoolName: schoolName.trim(),
        ownerName: ownerName.trim(),
        email: email.trim(),
        password,
        licence: licence.trim() || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? 'Could not set this server up.');
      throw new Error('rejected');
    }
    // Straight to the licence screen when the licence was refused, so the message has somewhere
    // to land; otherwise to School Setup, which is what a brand-new school needs next.
    router.push(data.licenceError ? '/settings/licence' : '/settings/school');
    router.refresh();
  });

  if (checking) {
    return (
      <AuthShell title="Setting up">
        <p className="text-sm text-oat">Checking this server…</p>
      </AuthShell>
    );
  }

  if (alreadySetUp) {
    return (
      <AuthShell
        title="Already set up"
        subtitle="This server already has a school on it. Setup can only run once."
        footer={
          <a href="/login" className="text-sm text-brand hover:underline">
            Go to sign in
          </a>
        }
      >
        <p className="text-sm text-oat">
          If you need another school, run a second Klasio server — one school per deployment.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Set up your school"
      subtitle="This creates your school and your owner account. It only happens once, on this server."
    >
      <form onSubmit={submit.run} className="space-y-5">
        <AuthFieldGroup>
          <AuthField
            label="School name"
            value={schoolName}
            onChange={(e) => setSchoolName(e.target.value)}
            placeholder="Brighton Academy"
            autoComplete="organization"
            required
            minLength={2}
            icon={<UserIcon />}
          />
          <AuthField
            label="Your name"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="Ama Mensah"
            autoComplete="name"
            required
            minLength={2}
            icon={<UserIcon />}
          />
          <AuthField
            label="Your email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@school.edu.gh"
            autoComplete="email"
            required
            icon={<MailIcon />}
          />
          <AuthField
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            required
            minLength={8}
            revealable
            icon={<LockIcon />}
          />
        </AuthFieldGroup>

        {/*
          Optional, and separated from the block above so it does not read as required. A school
          without one starts on the free package and can paste it later from Settings → Licence.
        */}
        <details className="rounded-xl border border-mist bg-white px-4 py-3">
          <summary className="text-[13px] text-oat cursor-pointer select-none flex items-center gap-2">
            <KeyIcon aria-hidden />
            Have a licence from your supplier? Add it now
          </summary>
          <textarea
            value={licence}
            onChange={(e) => setLicence(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder="eyJ2IjoxLCJsaWNlbmNlSWQiOi…"
            aria-label="Licence text"
            className="mt-3 w-full rounded-lg border border-mist bg-paper/60 px-3 py-2 text-xs font-mono break-all outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
          <p className="mt-2 text-xs text-oat">
            Without one you start on the free package. Nothing is lost — you can add it whenever it
            arrives.
          </p>
        </details>

        {error && <AuthError>{error}</AuthError>}

        <AuthButton
          state={submit.state}
          busyLabel="Creating…"
          doneLabel="Ready!"
          icon={<LockIcon />}
        >
          Create school
        </AuthButton>
      </form>
    </AuthShell>
  );
}
