'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Combobox from '@/components/Combobox';

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
  const [busy, setBusy] = useState(false);
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

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
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
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(
        Array.isArray(body.message)
          ? body.message.join('. ')
          : (body.message ?? 'Could not save those changes.'),
      );
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="no-print text-[12.5px] font-medium text-brand hover:underline underline-offset-2"
      >
        Edit details
      </button>
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
      <form onSubmit={submit} className="card w-full max-w-lg p-6">
        <h2 className="font-display text-2xl">Edit details</h2>
        <p className="text-sm text-oat mt-1.5">
          These appear on report cards, receipts and the ID card. The admission number cannot be
          changed — documents already issued carry it.
        </p>

        <div className="grid sm:grid-cols-2 gap-3 mt-5">
          <label className="text-[13px]">
            <span className="block text-oat mb-1">First name</span>
            <input
              name="firstName"
              required
              minLength={2}
              defaultValue={student.firstName}
              className={field}
            />
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Last name</span>
            <input
              name="lastName"
              required
              minLength={2}
              defaultValue={student.lastName}
              className={field}
            />
          </label>
          <label className="text-[13px] sm:col-span-2">
            <span className="block text-oat mb-1">Other names</span>
            <input name="otherNames" defaultValue={student.otherNames ?? ''} className={field} />
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
          <fieldset className="text-[13px]">
            <legend className="block text-oat mb-1">Gender</legend>
            <div className="flex gap-2">
              {[
                { v: 'FEMALE', l: 'Female' },
                { v: 'MALE', l: 'Male' },
              ].map((g) => (
                <button
                  key={g.v}
                  type="button"
                  onClick={() => setGender(g.v)}
                  aria-pressed={gender === g.v}
                  className={`flex-1 min-h-11 rounded-lg border text-sm transition ${
                    gender === g.v
                      ? 'bg-brand text-paper border-brand'
                      : 'border-mist bg-white hover:border-brand'
                  }`}
                >
                  {g.l}
                </button>
              ))}
            </div>
          </fieldset>
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
              Use this to correct a class set wrongly. To move a whole class up a year, use
              Promote.
            </p>
          </div>
        </div>

        {error && <p className="text-sm text-danger mt-4">{error}</p>}

        <div className="flex items-center gap-3 mt-5">
          <button
            disabled={busy}
            className="min-h-11 rounded-lg bg-brand text-paper text-sm font-medium px-5 hover:bg-brand-deep transition disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-11 px-3 text-[13px] text-oat hover:text-brand transition"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
