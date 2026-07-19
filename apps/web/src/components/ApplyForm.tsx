'use client';

import { useState } from 'react';
import { Button, useAsyncAction } from './Button';
import { CalendarIcon, MailIcon, PhoneIcon, SendIcon, UserIcon } from './icons';

interface Level {
  id: string;
  name: string;
}

interface Submitted {
  reference: string;
  message: string;
  schoolName: string;
}

/**
 * The public admissions form, filled in by a parent with no account on a cheap phone over a slow
 * connection. Everything is one column, every control is at least 44px tall, and only the four
 * fields the API actually insists on are required — anything else the office can ask for later.
 */
export default function ApplyForm({ schoolId, levels }: { schoolId: string; levels: Level[] }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Submitted | null>(null);

  const field =
    'w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-3 text-base outline-none focus:border-forest focus:ring-2 focus:ring-forest/15';
  const optional = <span className="font-normal text-oat">(optional)</span>;

  const submit = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    // Read synchronously: `currentTarget` is gone by the time the request resolves.
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? '').trim() || undefined;

    setError(null);
    try {
      const res = await fetch(`/api/apply/admissions/apply/${encodeURIComponent(schoolId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: text('firstName'),
          lastName: text('lastName'),
          dateOfBirth: text('dateOfBirth'),
          gender: text('gender'),
          levelId: text('levelId'),
          guardianName: text('guardianName'),
          guardianPhone: text('guardianPhone'),
          guardianEmail: text('guardianEmail'),
          previousSchool: text('previousSchool'),
          notes: text('notes'),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(plainError(data));
      setDone(data as Submitted);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'We could not send your application. Please check your internet and try again.',
      );
      // Re-thrown so the button lands on its failed state rather than showing a tick.
      throw err;
    }
  });

  if (done) {
    return (
      <div className="mt-6" role="status">
        <div className="rounded-lg bg-leaf/10 border border-leaf/20 p-5 text-center">
          <p className="font-display text-xl text-leaf">Application sent</p>
          <p className="text-sm text-ink/80 mt-2">
            Thank you. {done.schoolName} has received your application.
          </p>
        </div>

        <div className="mt-5 rounded-lg bg-parchment/70 p-5 text-center">
          <p className="text-[11px] uppercase tracking-widest text-oat">Your reference number</p>
          <p className="font-display text-3xl tabular mt-1">{done.reference}</p>
        </div>

        <p className="mt-5 text-sm text-ink/80 leading-relaxed">{done.message}</p>
        <p className="mt-3 text-sm text-oat leading-relaxed">
          Please write this number down or take a photo of this page. The school will call you on
          the phone number you gave.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit.run} className="mt-6 space-y-4">
      <p className="text-sm text-oat">
        Fields marked <span className="text-danger">*</span> are needed. The rest you can leave
        empty.
      </p>

      <fieldset className="space-y-4 border-t border-mist pt-4">
        <legend className="sr-only">About the child</legend>
        <p className="text-sm font-medium text-forest">About the child</p>

        <label className="block text-sm font-medium">
          Child&rsquo;s first name <span className="text-danger">*</span>
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
              <UserIcon />
            </span>
            <input
              name="firstName"
              required
              minLength={2}
              maxLength={60}
              autoComplete="off"
              className={`${field} pl-10`}
            />
          </div>
        </label>

        <label className="block text-sm font-medium">
          Child&rsquo;s surname <span className="text-danger">*</span>
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
              <UserIcon />
            </span>
            <input
              name="lastName"
              required
              minLength={2}
              maxLength={60}
              autoComplete="off"
              className={`${field} pl-10`}
            />
          </div>
        </label>

        <label className="block text-sm font-medium">
          Date of birth {optional}
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
              <CalendarIcon />
            </span>
            <input name="dateOfBirth" type="date" className={`${field} pl-10`} />
          </div>
        </label>

        <label className="block text-sm font-medium">
          Gender {optional}
          <select name="gender" defaultValue="" className={`${field} mt-1.5`}>
            <option value="">Prefer not to say</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
          </select>
        </label>

        {levels.length > 0 && (
          <label className="block text-sm font-medium">
            Class you are applying for {optional}
            <select name="levelId" defaultValue="" className={`${field} mt-1.5`}>
              <option value="">Not sure yet</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block text-sm font-medium">
          Present or last school {optional}
          <input name="previousSchool" maxLength={120} className={`${field} mt-1.5`} />
        </label>
      </fieldset>

      <fieldset className="space-y-4 border-t border-mist pt-4">
        <legend className="sr-only">About you</legend>
        <p className="text-sm font-medium text-forest">About you, the parent or guardian</p>

        <label className="block text-sm font-medium">
          Your full name <span className="text-danger">*</span>
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
              <UserIcon />
            </span>
            <input
              name="guardianName"
              required
              minLength={2}
              maxLength={120}
              autoComplete="name"
              className={`${field} pl-10`}
            />
          </div>
        </label>

        <label className="block text-sm font-medium">
          Your phone number <span className="text-danger">*</span>
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
              <PhoneIcon />
            </span>
            <input
              name="guardianPhone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              placeholder="024 123 4567"
              className={`${field} pl-10`}
            />
          </div>
          <span className="mt-1 block text-[13px] font-normal text-oat">
            This is how the school will reach you.
          </span>
        </label>

        <label className="block text-sm font-medium">
          Your email {optional}
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
              <MailIcon />
            </span>
            <input
              name="guardianEmail"
              type="email"
              inputMode="email"
              autoComplete="email"
              className={`${field} pl-10`}
            />
          </div>
        </label>

        <label className="block text-sm font-medium">
          Anything else the school should know {optional}
          <textarea name="notes" maxLength={1000} rows={4} className={`${field} mt-1.5`} />
        </label>
      </fieldset>

      {error && (
        <p
          role="alert"
          className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2"
        >
          {error}
        </p>
      )}

      {/*
        The public door keeps its forest palette rather than the portal's brand teal, so the
        primary variant's own background is overridden — but only while the button is offering
        itself, since the tick and the alert carry their own colours and must not be repainted.
      */}
      <Button
        type="submit"
        state={submit.state}
        icon={<SendIcon />}
        className={`w-full py-3 ${
          submit.state === 'done' || submit.state === 'failed'
            ? ''
            : 'bg-forest! hover:bg-forest-deep!'
        }`}
      >
        Send application
      </Button>
      <p className="text-[11px] text-oat text-center">
        The school will use these details only to contact you about this application.
      </p>
    </form>
  );
}

/**
 * class-validator speaks in property names ("guardianPhone must be a string"), which means
 * nothing to a parent. Anything the service itself raises is already plain English, so it is
 * passed straight through; only the field-level complaints are translated.
 */
function plainError(data: unknown): string {
  const raw = (data as { message?: string | string[] })?.message;
  const messages = Array.isArray(raw) ? raw : raw ? [raw] : [];

  const byField: Record<string, string> = {
    firstName: 'Please enter the child’s first name (at least 2 letters).',
    lastName: 'Please enter the child’s surname (at least 2 letters).',
    dateOfBirth: 'Please check the date of birth, or leave it empty.',
    gender: 'Please choose Male or Female, or leave it empty.',
    levelId: 'Please pick a class from the list, or leave it empty.',
    guardianName: 'Please enter your full name (at least 2 letters).',
    guardianPhone: 'Please enter your phone number, for example 024 123 4567.',
    guardianEmail: 'Please check your email address, or leave it empty.',
    previousSchool: 'The name of the present or last school is too long.',
    notes: 'Your note is too long. Please shorten it.',
  };

  const friendly: string[] = [];
  for (const m of messages) {
    const field = Object.keys(byField).find((k) => m.startsWith(`${k} `));
    const line = field ? byField[field] : m;
    if (!friendly.includes(line)) friendly.push(line);
  }
  return friendly.join(' ') || 'Something was not right with the form. Please check and try again.';
}
