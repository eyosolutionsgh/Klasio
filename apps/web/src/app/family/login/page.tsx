'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/AuthShell';
import { AuthButton, AuthError, AuthField, AuthFieldGroup } from '@/components/AuthField';
import { useAsyncAction } from '@/components/Button';
import { ChoiceCards } from '@/components/ChoiceCards';
import { KeyIcon, MailIcon, PhoneIcon, SendIcon, UserIcon } from '@/components/icons';

interface SentTo {
  phone: string;
  email: string | null;
}

/**
 * Guardian sign-in: a phone number or email address, then a 6-digit code. No password —
 * guardians in Ghana are reachable by phone, and many share a device.
 *
 * Whichever identifier is typed, the code is keyed to the family's phone on the API side, so the
 * two entry points converge and this page never has to remember which was used. The channel only
 * decides where the code is delivered: email is offered because SMS to Ghanaian networks fails in
 * ways the school cannot fix, and a family that keeps missing texts needs a way through.
 */
export default function FamilyLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<'identifier' | 'code'>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [channel, setChannel] = useState<'sms' | 'email'>('sms');
  const [sentTo, setSentTo] = useState<SentTo | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const request = useAsyncAction(async () => {
    setError(null);
    const res = await fetch('/api/family/guardian/auth/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, channel }),
    }).catch(() => undefined);
    // Absent whenever the API declines to describe where the code went — an identifier it does
    // not hold, or a caller that has spent its disclosure budget. The wording below covers both
    // without the page having to know which happened.
    const data = res ? await res.json().catch(() => null) : null;
    setSentTo(data?.sentTo ?? null);
    // Always advance: the API deliberately does not reveal whether an identifier is registered.
    setStep('code');
  });

  const signIn = useAsyncAction(async () => {
    setError(null);
    const res = await fetch('/api/guardian-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, code }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? 'That code is not valid.');
      // Thrown so the button settles on its failed state rather than claiming success — the
      // request completed, but the sign-in did not.
      throw new Error('rejected');
    }
    router.push('/family');
    router.refresh();
  });

  const channelLabel = channel === 'sms' ? 'SMS' : 'email';

  return (
    <AuthShell
      title="Parent & guardian"
      subtitle={
        step === 'identifier'
          ? 'Enter the phone number or email address the school has for you.'
          : sentTo
            ? `We sent a 6-digit code by ${channelLabel}. It expires in 10 minutes.`
            : // Hedged on purpose. The API will not say whether this identifier belongs to a
              // family, so the page must not promise a message that may never arrive.
              'If those details match a family we hold, your 6-digit code is on its way. It expires in 10 minutes.'
      }
      footer={
        <p className="text-[13px] text-oat">
          Never share your code. The school will never ask you for it.
        </p>
      }
    >
      {step === 'identifier' ? (
        <form onSubmit={request.run} aria-label="Request a sign-in code">
          <AuthFieldGroup>
            <AuthField
              label="Phone number or email"
              type="text"
              icon={<UserIcon />}
              autoComplete="username"
              required
              autoFocus
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="024 123 4567 or you@example.com"
            />
          </AuthFieldGroup>

          <ChoiceCards
            className="mt-5"
            legend="Send it by"
            name="channel"
            value={channel}
            onChange={setChannel}
            options={[
              { value: 'sms', label: 'SMS', icon: <PhoneIcon /> },
              { value: 'email', label: 'Email', icon: <MailIcon /> },
            ]}
          />

          {error && <AuthError>{error}</AuthError>}
          <div className="mt-7">
            <AuthButton
              state={request.state}
              busyLabel="Sending…"
              doneLabel="Sent!"
              icon={<SendIcon />}
            >
              Send me a code
            </AuthButton>
          </div>
        </form>
      ) : (
        <form onSubmit={signIn.run} aria-label="Enter your sign-in code">
          {/*
            Where the code went, masked. A parent with two numbers, or one who is not sure which
            address the school has, otherwise has to guess which device to pick up. The channel
            that carried it is marked so the other line reads as context, not a second copy.
          */}
          {sentTo && (
            <dl className="mb-5 rounded-lg bg-parchment/60 px-4 py-3 text-[13px]">
              <div className="flex items-baseline gap-2">
                <dt className="w-14 shrink-0 text-oat">SMS</dt>
                <dd className={channel === 'sms' ? 'font-medium text-ink' : 'text-oat'}>
                  {sentTo.phone}
                </dd>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <dt className="w-14 shrink-0 text-oat">Email</dt>
                <dd className={channel === 'email' ? 'font-medium text-ink' : 'text-oat'}>
                  {sentTo.email ?? 'None on file'}
                </dd>
              </div>
            </dl>
          )}

          <AuthFieldGroup>
            {/*
              Not `revealable`: a one-time code is typed once from a message the person is already
              holding, so a reveal toggle buys nothing and puts the code on screen in a shared room.
            */}
            <AuthField
              label="6-digit code"
              inputMode="numeric"
              icon={<KeyIcon />}
              autoComplete="one-time-code"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="tabular tracking-[0.3em]"
            />
          </AuthFieldGroup>
          {error && <AuthError>{error}</AuthError>}
          <div className="mt-7 flex items-center gap-2 flex-wrap">
            <AuthButton
              state={signIn.state}
              busyLabel="Checking…"
              doneLabel="Signed in!"
              icon={<KeyIcon />}
            >
              Sign in
            </AuthButton>
            <button
              type="button"
              onClick={() => {
                setStep('identifier');
                setCode('');
                setSentTo(null);
                setError(null);
              }}
              className="min-h-11 px-3 text-[13px] text-oat hover:text-brand transition"
            >
              Use different details
            </button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
