'use client';

import { useState } from 'react';
import Link from 'next/link';
import AuthShell from '@/components/AuthShell';
import { AuthButton, AuthError, AuthField, AuthFieldGroup } from '@/components/AuthField';

type Channel = 'email' | 'sms';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [channel, setChannel] = useState<Channel>('email');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'request', email, channel }),
    });
    setBusy(false);
    if (res.ok) setSent(true);
    else setError('Something went wrong. Please try again.');
  }

  /**
   * The confirmation says "if there is an account", not "we sent it".
   *
   * The API answers identically for an address with no account, so a page that promised delivery
   * would turn this screen into the account-enumeration oracle that sign-in carefully is not —
   * type an address, read the message, learn whether that person works at a school on the
   * platform. The wording is the last place that guarantee can be given away.
   */
  if (sent && channel === 'sms') {
    /**
     * "If we hold a mobile number" carries the same weight as "if there is an account" above.
     *
     * `User.phone` is optional, so the API sends nothing when there is no number on file — and it
     * still answers exactly as it does on success, because saying "no number on file" would
     * confirm the account exists and describe what it holds.
     */
    return (
      <AuthShell title="Check your phone">
        <p className="text-sm text-oat leading-relaxed">
          If there is an account for <span className="text-ink">{email}</span> and we hold a mobile
          number for it, a six-digit code is on its way. It expires in 30 minutes.
        </p>
        <div className="mt-7 flex items-center gap-5">
          <Link
            href={`/reset-password?email=${encodeURIComponent(email)}`}
            className="min-h-11 inline-flex items-center rounded-lg px-10 text-sm font-semibold uppercase tracking-wider text-ink bg-gradient-to-r from-[#00b3b9] to-gold-bright hover:from-[#00c2c8] hover:to-[#00a7ad] transition-all"
          >
            Enter the code
          </Link>
          <Link href="/login" className="text-sm text-oat hover:text-brand transition">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (sent) {
    return (
      <AuthShell title="Check your email">
        <p className="text-sm text-oat leading-relaxed">
          If there is an account for <span className="text-ink">{email}</span>, a link to choose a
          new password is on its way. It expires in 30 minutes.
        </p>
        <p className="mt-4 text-sm text-oat leading-relaxed">
          Nothing arrived? Check spam, or ask whoever manages accounts at your school to set a new
          password for you from <span className="text-ink">Staff</span>.
        </p>
        <div className="mt-7">
          <Link href="/login" className="text-sm text-oat hover:text-brand transition">
            ← Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password">
      <p className="mb-5 text-sm text-oat leading-relaxed">
        Enter the email address you sign in with and choose how to receive it.
      </p>
      <form onSubmit={submit} aria-label="Reset your password">
        <AuthFieldGroup>
          <AuthField
            label="Email address"
            type="email"
            required
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@school.edu.gh"
          />
        </AuthFieldGroup>

        <fieldset className="mt-5">
          <legend className="mb-2 text-[13px] font-medium text-ink">Send it by</legend>
          <div className="flex gap-2" role="radiogroup" aria-label="Send it by">
            {(
              [
                { value: 'email', label: 'Email', hint: 'A link to the address above' },
                { value: 'sms', label: 'Text message', hint: 'A code to your mobile number' },
              ] as const
            ).map((opt) => (
              <label
                key={opt.value}
                className={`flex-1 cursor-pointer rounded-lg border px-4 py-3 transition ${
                  channel === opt.value
                    ? 'border-gold bg-gold/10'
                    : 'border-ink/15 hover:border-ink/30'
                }`}
              >
                <input
                  type="radio"
                  name="channel"
                  value={opt.value}
                  checked={channel === opt.value}
                  onChange={() => setChannel(opt.value)}
                  className="sr-only"
                />
                <span className="block text-sm font-medium text-ink">{opt.label}</span>
                <span className="mt-0.5 block text-[12px] text-oat">{opt.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && <AuthError>{error}</AuthError>}

        <div className="mt-7 flex items-center gap-5">
          <AuthButton busy={busy} busyLabel="Sending…">
            {channel === 'sms' ? 'Send code' : 'Send link'}
          </AuthButton>
          <Link href="/login" className="text-sm text-oat hover:text-brand transition">
            Back to sign in
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
