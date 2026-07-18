'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Combobox from './Combobox';
import DownloadButton from './DownloadButton';

const field =
  'w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

export interface ApplicantRow {
  id: string;
  reference: string;
  name: string;
  levelName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  stage: string;
  studentId: string | null;
  allowedStages: string[];
}

const STAGE_LABELS: Record<string, string> = {
  ENQUIRY: 'Enquiry',
  APPLIED: 'Applied',
  ASSESSED: 'Assessed',
  OFFERED: 'Offered',
  ACCEPTED: 'Accepted',
  ENROLLED: 'Enrolled',
  DECLINED: 'Declined',
};

/**
 * Everything the office can do to one application: move it along, enrol it, or print the
 * letter. Enrolment is the only action that can fail for a reason the user cannot fix here —
 * the package cap — so its message is shown verbatim from the API.
 */
export default function ApplicantActions({
  applicant,
  classes,
}: {
  applicant: ApplicantRow;
  classes: { id: string; name: string; studentCount: number }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [classId, setClassId] = useState('');
  const [gender, setGender] = useState(applicant.gender ?? '');
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  async function post(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/proxy/admissions/${applicant.id}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(
        Array.isArray(data.message) ? data.message.join('. ') : (data.message ?? 'Did not save.'),
      );
      return null;
    }
    return data;
  }

  async function move(stage: string) {
    if (!stage) return;
    if ((await post('stage', { stage })) !== null) router.refresh();
  }

  async function enrol(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const data = await post('convert', {
      classId,
      dateOfBirth: applicant.dateOfBirth
        ? undefined
        : String(f.get('dateOfBirth') ?? '') || undefined,
      gender: applicant.gender ? undefined : gender || undefined,
    });
    if (data) {
      setEnrolling(false);
      router.push(`/students/${data.studentId}`);
      router.refresh();
    }
  }

  const canEnrol = applicant.stage === 'ACCEPTED' && !applicant.studentId;
  const hasLetter = ['OFFERED', 'ACCEPTED', 'ENROLLED'].includes(applicant.stage);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {applicant.allowedStages.length > 0 && (
        <Combobox
          label="Move to"
          className="w-40"
          clearLabel="Move to…"
          placeholder="Search stages…"
          options={applicant.allowedStages.map((s) => ({
            value: s,
            label: STAGE_LABELS[s] ?? s,
          }))}
          value=""
          disabled={busy}
          onChange={move}
        />
      )}

      {canEnrol && (
        <button
          onClick={() => setEnrolling(true)}
          className="self-end min-h-11 rounded-lg bg-brand text-paper text-sm font-medium px-4 hover:bg-brand-deep transition"
        >
          Enrol
        </button>
      )}

      {applicant.studentId && (
        <a
          href={`/students/${applicant.studentId}`}
          className="self-end min-h-11 inline-flex items-center text-sm text-brand hover:underline underline-offset-2 px-2"
        >
          Open record
        </a>
      )}

      {hasLetter && (
        <span className="self-end">
          <DownloadButton
            path={`/admissions/${applicant.id}/letter`}
            filename={`admission-${applicant.reference}.pdf`}
            label="Letter"
            variant="ghost"
            tip="Print the admission letter for this applicant"
          />
        </span>
      )}

      {error && <span className="w-full text-right text-[12px] text-danger">{error}</span>}

      {/* Portalled to the body: the page wraps sections in `.rise`, and a transformed ancestor
          becomes the containing block for `position: fixed`. */}
      {enrolling &&
        mounted &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Enrol this applicant"
            className="brand-scope fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
            onClick={(e) => e.target === e.currentTarget && setEnrolling(false)}
          >
            <form
              onSubmit={enrol}
              className="card w-full max-w-md p-6"
              onKeyDown={(e) => e.key === 'Escape' && setEnrolling(false)}
            >
              <h2 className="font-display text-2xl">Enrol {applicant.name}</h2>
              <p className="text-sm text-oat mt-1.5">
                {applicant.reference} · this creates the student record and counts towards your
                package&apos;s enrolment limit.
              </p>

              <div className="mt-5 space-y-3">
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

                {/* The application form does not insist on these, but a student record does. */}
                {!applicant.dateOfBirth && (
                  <label className="block text-[13px]">
                    <span className="block text-oat mb-1">Date of birth</span>
                    <input name="dateOfBirth" type="date" required className={field} />
                  </label>
                )}
                {!applicant.gender && (
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
                )}
              </div>

              {error && <p className="text-sm text-danger mt-4">{error}</p>}

              <div className="flex items-center gap-3 mt-6">
                <button
                  disabled={busy || !classId || (!applicant.gender && !gender)}
                  className="min-h-11 rounded-lg bg-brand text-paper text-sm font-medium px-5 hover:bg-brand-deep transition disabled:opacity-50"
                >
                  {busy ? 'Enrolling…' : 'Enrol student'}
                </button>
                <button
                  type="button"
                  onClick={() => setEnrolling(false)}
                  className="min-h-11 px-3 text-[13px] text-oat hover:text-brand transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>,
          document.body,
        )}
    </div>
  );
}
