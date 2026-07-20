'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Combobox from './Combobox';
import { Button, useAsyncAction } from './Button';
import { ChoiceCards } from './ChoiceCards';
import { CalendarIcon, PhoneIcon, PlusIcon, UserIcon } from './icons';

const field =
  'w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

/**
 * Enrol one student. The bulk Excel import covers a whole intake; this covers the child who
 * turns up in week three, which is the common case once a school is running.
 */
export default function AddStudent({
  classes,
}: {
  classes: { id: string; name: string; studentCount: number }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [classId, setClassId] = useState('');
  const [gender, setGender] = useState('FEMALE');
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const submit = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    // Read synchronously: `currentTarget` is gone by the time the fetch below resolves.
    const f = new FormData(e.currentTarget);
    setError(null);
    const res = await fetch('/api/proxy/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: String(f.get('firstName') ?? '').trim(),
        lastName: String(f.get('lastName') ?? '').trim(),
        otherNames: String(f.get('otherNames') ?? '').trim() || undefined,
        gender,
        dateOfBirth: String(f.get('dateOfBirth') ?? ''),
        classId,
        // A guardian is optional here so the office is never blocked, but it is the phone the
        // parent portal signs in with — so it is asked for up front.
        guardianFirstName: String(f.get('guardianFirstName') ?? '').trim() || undefined,
        guardianLastName: String(f.get('guardianLastName') ?? '').trim() || undefined,
        guardianPhone: String(f.get('guardianPhone') ?? '').trim() || undefined,
        guardianRelationship: String(f.get('guardianRelationship') ?? '').trim() || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        Array.isArray(body.message)
          ? body.message.join('. ')
          : (body.message ?? 'Could not enrol.'),
      );
      // The button may only report failure once the action has actually rejected.
      throw new Error('rejected');
    }
    setOpen(false);
    router.push(`/students/${body.id}`);
    router.refresh();
  });

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} icon={<PlusIcon />}>
        Add student
      </Button>
    );
  }

  // Rendered into <body>: the page wraps sections in `.rise`, whose animation applies a
  // transform, and a transformed ancestor becomes the containing block for `position: fixed` —
  // so an inline dialog would anchor to that section instead of the viewport.
  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Enrol a student"
      className="brand-scope fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
      onClick={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <form
        onSubmit={submit.run}
        className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        <h2 className="font-display text-2xl">Enrol a student</h2>
        <p className="text-sm text-oat mt-1.5">The admission number is assigned automatically.</p>

        <div className="grid sm:grid-cols-2 gap-3 mt-5">
          <label className="text-[13px]">
            <span className="block text-oat mb-1">First name</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                <UserIcon />
              </span>
              <input name="firstName" required minLength={2} className={`${field} pl-10`} />
            </div>
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Last name</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                <UserIcon />
              </span>
              <input name="lastName" required minLength={2} className={`${field} pl-10`} />
            </div>
          </label>
          <label className="text-[13px] sm:col-span-2">
            <span className="block text-oat mb-1">Other names</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                <UserIcon />
              </span>
              <input name="otherNames" className={`${field} pl-10`} />
            </div>
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Date of birth</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                <CalendarIcon />
              </span>
              <input name="dateOfBirth" type="date" required className={`${field} pl-10`} />
            </div>
          </label>
          <ChoiceCards
            className="text-[13px]"
            legend="Gender"
            name="gender"
            value={gender}
            onChange={setGender}
            options={[
              { value: 'FEMALE', label: 'Female' },
              { value: 'MALE', label: 'Male' },
            ]}
          />
          <div className="sm:col-span-2">
            <Combobox
              label="Class"
              allowClear={false}
              placeholder="Search classes…"
              options={classes.map((c) => ({
                value: c.id,
                label: c.name,
                hint: `${c.studentCount} student${c.studentCount === 1 ? '' : 's'}`,
              }))}
              value={classId}
              onChange={setClassId}
            />
          </div>
        </div>

        <h3 className="font-display text-lg mt-6">Guardian</h3>
        <p className="text-xs text-oat mt-1">
          This phone number is how the guardian signs in to the portal. An existing guardian with
          the same number is reused, so siblings stay together.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <label className="text-[13px]">
            <span className="block text-oat mb-1">First name</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                <UserIcon />
              </span>
              <input name="guardianFirstName" className={`${field} pl-10`} />
            </div>
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Last name</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                <UserIcon />
              </span>
              <input name="guardianLastName" className={`${field} pl-10`} />
            </div>
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Phone</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                <PhoneIcon />
              </span>
              <input
                name="guardianPhone"
                type="tel"
                inputMode="tel"
                placeholder="024 123 4567"
                className={`${field} pl-10`}
              />
            </div>
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Relationship</span>
            <input name="guardianRelationship" placeholder="Mother" className={field} />
          </label>
        </div>

        {error && <p className="text-sm text-danger mt-4">{error}</p>}

        <div className="flex items-center gap-3 mt-6">
          {/* "Enrol" is not one of the conjugated verbs, so its wording is spelled out. */}
          <Button
            type="submit"
            state={submit.state}
            disabled={!classId}
            icon={<UserIcon />}
            pendingLabel="Enrolling…"
            doneLabel="Enrolled!"
            failedLabel="Couldn't enrol"
          >
            Enrol student
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {!classId && <span className="text-[12px] text-oat">Pick a class first.</span>}
        </div>
      </form>
    </div>,
    document.body,
  );
}
