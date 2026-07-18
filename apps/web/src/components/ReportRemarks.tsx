'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Inline editing of the human parts of a terminal report. The head teacher's remark is only
 * offered to HEAD/OWNER — the API enforces the same rule, this just avoids showing a field
 * the user cannot save.
 */
export default function ReportRemarks({
  studentId,
  termId,
  role,
  published,
  initial,
}: {
  studentId: string;
  termId: string;
  role: string;
  published: boolean;
  initial: {
    conduct: string | null;
    interest: string | null;
    teacherRemark: string | null;
    headRemark: string | null;
  };
}) {
  const router = useRouter();
  const isHead = ['OWNER', 'HEAD'].includes(role);
  const [conduct, setConduct] = useState(initial.conduct ?? '');
  const [interest, setInterest] = useState(initial.interest ?? '');
  const [teacherRemark, setTeacherRemark] = useState(initial.teacherRemark ?? '');
  const [headRemark, setHeadRemark] = useState(initial.headRemark ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    const body: Record<string, string> = { conduct, interest, teacherRemark };
    if (isHead) body.headRemark = headRemark;
    const res = await fetch(`/api/proxy/assessment/reports/${studentId}/${termId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMessage('Saved.');
      router.refresh();
    } else {
      setMessage(data.message ?? 'Could not save.');
    }
  }

  if (published) {
    return (
      <p className="no-print text-xs text-oat mt-4">
        This report is published. Unpublish it from the reports list to edit remarks.
      </p>
    );
  }

  const field =
    'w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

  return (
    <div className="no-print card p-5 mt-6">
      <h3 className="font-display text-lg">Remarks</h3>
      <p className="text-xs text-oat mt-1">These appear on the printed report card and the PDF.</p>
      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        <label className="text-[13px]">
          <span className="block text-oat mb-1">Conduct</span>
          <input value={conduct} onChange={(e) => setConduct(e.target.value)} className={field} />
        </label>
        <label className="text-[13px]">
          <span className="block text-oat mb-1">Interest</span>
          <input value={interest} onChange={(e) => setInterest(e.target.value)} className={field} />
        </label>
      </div>
      <label className="block text-[13px] mt-3">
        <span className="block text-oat mb-1">Class teacher&apos;s remark</span>
        <textarea
          rows={2}
          value={teacherRemark}
          onChange={(e) => setTeacherRemark(e.target.value)}
          className={field}
        />
      </label>
      <label className="block text-[13px] mt-3">
        <span className="block text-oat mb-1">
          Head teacher&apos;s remark
          {!isHead && <span className="ml-2 text-[11px]">(head teacher only)</span>}
        </span>
        <textarea
          rows={2}
          value={headRemark}
          disabled={!isHead}
          onChange={(e) => setHeadRemark(e.target.value)}
          className={`${field} disabled:bg-parchment/60 disabled:text-oat`}
        />
      </label>
      <div className="flex items-center gap-3 mt-4">
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-brand text-paper text-sm font-medium px-5 py-2 hover:bg-brand-deep transition disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save remarks'}
        </button>
        {message && <p className="text-sm text-brand">{message}</p>}
      </div>
    </div>
  );
}
