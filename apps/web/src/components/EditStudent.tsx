'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Combobox from '@/components/Combobox';
import { Button, useAsyncAction } from '@/components/Button';
import { ChoiceCards } from '@/components/ChoiceCards';
import { EditIcon, SaveIcon, UserIcon } from '@/components/icons';

const field =
  'w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

interface ClassOption {
  id: string;
  name: string;
}

/**
 * Correct a student's own details.
 *
 * The API has always accepted these edits; nothing in the product ever sent them. Only medical
 * notes were editable, so a name mis-keyed at enrolment was permanent — and it prints on every
 * report card, every receipt and the child's ID card. A school's only escape was to withdraw the
 * child and enrol them again, losing their marks, their attendance and their fee history.
 *
 * The admission number is deliberately not editable here: it is the school's own permanent
 * reference, and changing it would orphan documents already issued under it.
 */
export default function EditStudent({
  studentId,
  student,
}: {
  studentId: string;
  student: {
    firstName: string;
    lastName: string;
    otherNames: string | null;
    gender: string;
    dateOfBirth: string;
    classId: string | null;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gender, setGender] = useState(student.gender);
  const [classId, setClassId] = useState(student.classId ?? '');
  const [classes, setClasses] = useState<ClassOption[]>([]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    fetch('/api/proxy/school/structure')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setClasses(d.classes ?? []))
      .catch(() => undefined);
  }, [open]);

  const submit = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    const f = new FormData(e.currentTarget);
    setError(null);
    const res = await fetch(`/api/proxy/students/${studentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: String(f.get('firstName') ?? '').trim(),
        lastName: String(f.get('lastName') ?? '').trim(),
        // Cleared rather than omitted, so a name added by mistake can be taken off again.
        otherNames: String(f.get('otherNames') ?? '').trim(),
        gender,
        dateOfBirth: String(f.get('dateOfBirth') ?? ''),
        ...(classId ? { classId } : {}),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // The API's wording names the field that was wrong, which "Couldn't save" cannot.
      setError(
        Array.isArray(body.message)
          ? body.message.join('. ')
          : (body.message ?? 'Could not save those changes.'),
      );
      throw new Error('save rejected');
    }
    setOpen(false);
    router.refresh();
  });

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        icon={<EditIcon />}
        className="no-print"
      >
        Edit details
      </Button>
    );
  }
  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit student details"
      className="brand-scope fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4 overflow-y-auto"
      onClick={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <form onSubmit={submit.run} className="card w-full max-w-lg p-6">
        <h2 className="font-display text-2xl">Edit details</h2>
        <p className="text-sm text-oat mt-1.5">
          These appear on terminal reports, receipts and the ID card. The admission number cannot be
          changed — documents already issued carry it.
        </p>

        <div className="grid sm:grid-cols-2 gap-3 mt-5">
          <label className="text-[13px]">
            <span className="block text-oat mb-1">First name</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                <UserIcon />
              </span>
              <input
                name="firstName"
                required
                minLength={2}
                defaultValue={student.firstName}
                className={`${field} pl-10`}
              />
            </div>
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Last name</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                <UserIcon />
              </span>
              <input
                name="lastName"
                required
                minLength={2}
                defaultValue={student.lastName}
                className={`${field} pl-10`}
              />
            </div>
          </label>
          <label className="text-[13px] sm:col-span-2">
            <span className="block text-oat mb-1">Other names</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                <UserIcon />
              </span>
              <input
                name="otherNames"
                defaultValue={student.otherNames ?? ''}
                className={`${field} pl-10`}
              />
            </div>
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Date of birth</span>
            <input
              name="dateOfBirth"
              type="date"
              required
              defaultValue={student.dateOfBirth?.slice(0, 10)}
              className={field}
            />
          </label>
          <ChoiceCards
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
              options={classes.map((c) => ({ value: c.id, label: c.name }))}
              value={classId}
              onChange={setClassId}
            />
            <p className="text-[11px] text-oat mt-1">
              Use this to correct a class set wrongly. To move a whole class up a year, use Promote.
            </p>
          </div>
        </div>

        {error && <p className="text-sm text-danger mt-4">{error}</p>}

        <div className="flex items-center gap-3 mt-5">
          <Button type="submit" state={submit.state} icon={<SaveIcon />}>
            Save changes
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
