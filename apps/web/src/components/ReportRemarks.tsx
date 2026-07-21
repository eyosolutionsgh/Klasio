'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useAsyncAction } from './Button';
import { SaveIcon } from './icons';

type RemarkKind = 'TEACHER' | 'HEAD' | 'CONDUCT' | 'INTEREST';

interface BankEntry {
  id: string;
  text: string;
  minScore: number | null;
  maxScore: number | null;
  uses: number;
  matchesBand: boolean;
}

/**
 * The school's banked phrasing for one field, offered rather than imposed.
 *
 * Loaded on demand: a teacher writing their own comment should not pay for a fetch they never
 * look at, and the bank only helps at the moment someone is stuck. Picking one replaces the
 * field — the text stays editable afterwards, so it is a starting point, not a stamp.
 */
function RemarkPicker({
  kind,
  score,
  onPick,
}: {
  kind: RemarkKind;
  score?: number;
  onPick: (text: string) => void;
}) {
  const [entries, setEntries] = useState<BankEntry[] | null>(null);
  const [open, setOpen] = useState(false);

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (entries) return;
    const query = new URLSearchParams({ kind });
    // The score is what makes the offer worth reading: banded comments come back first.
    if (typeof score === 'number') query.set('score', String(Math.round(score)));
    const res = await fetch(`/api/proxy/remarks?${query}`);
    setEntries(res.ok ? await res.json() : []);
  }

  function pick(entry: BankEntry) {
    onPick(entry.text);
    setOpen(false);
    // Counting the use is what lets the school's own house style float to the top over a term.
    // Failing to count it must never cost the teacher their comment, so it is not awaited.
    fetch(`/api/proxy/remarks/${entry.id}/use`, { method: 'POST' }).catch(() => undefined);
  }

  return (
    <span className="block mt-1">
      <button
        type="button"
        onClick={toggle}
        className="text-[11.5px] text-brand hover:underline underline-offset-2"
      >
        {open ? 'Hide bank' : 'Choose from bank'}
      </button>
      {open && (
        <span className="block mt-1.5 space-y-1">
          {entries === null && <span className="block text-[11px] text-oat">Loading…</span>}
          {entries?.length === 0 && (
            <span className="block text-[11px] text-oat">
              Nothing banked for this yet — add some under Records setup.
            </span>
          )}
          {entries?.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => pick(e)}
              className="block w-full text-left text-[12.5px] rounded-lg border border-mist px-2.5 py-1.5 hover:border-brand hover:bg-parchment/60 transition"
            >
              {e.text}
              {e.matchesBand && (
                <span className="text-[10px] text-oat ml-2 tabular">
                  {e.minScore ?? 0}–{e.maxScore ?? 100}
                </span>
              )}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/**
 * §21's remark help: a draft from the child's own numbers, dropped into the editable field.
 * The teacher edits and saves — or ignores it. Failure is a sentence, never a broken form,
 * because a school without an AI key still writes remarks the ordinary way.
 */
function AiDraftButton({
  studentId,
  termId,
  kind,
  onDraft,
}: {
  studentId: string;
  termId: string;
  kind: 'TEACHER' | 'HEAD';
  onDraft: (text: string) => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const draft = useAsyncAction(async () => {
    setNote(null);
    const res = await fetch('/api/proxy/ai/remarks/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, termId, kind }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNote(d.message ?? 'AI is not available on this server.');
      throw new Error('rejected');
    }
    onDraft(d.draft);
  });
  return (
    <span className="inline-flex items-center gap-2 ml-3">
      <button
        type="button"
        onClick={draft.run}
        disabled={draft.state === 'pending'}
        className="text-[11.5px] text-brand hover:underline underline-offset-2 disabled:opacity-50"
      >
        {draft.state === 'pending' ? 'Drafting…' : 'Draft with AI'}
      </button>
      {note && <span className="text-[11px] text-oat">{note}</span>}
    </span>
  );
}

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
  score,
  initial,
}: {
  studentId: string;
  termId: string;
  role: string;
  published: boolean;
  /** This child's average out of 100, used to offer band-appropriate remarks first. */
  score?: number;
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
  const [error, setError] = useState<string | null>(null);

  const save = useAsyncAction(async () => {
    setError(null);
    const body: Record<string, string> = { conduct, interest, teacherRemark };
    if (isHead) body.headRemark = headRemark;
    const res = await fetch(`/api/proxy/assessment/reports/${studentId}/${termId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message ?? 'Could not save.');
      throw new Error('rejected');
    }
    router.refresh();
  });

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
      <p className="text-xs text-oat mt-1">
        These appear on the printed terminal report and the PDF.
      </p>
      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        <div className="text-[13px]">
          <label className="block">
            <span className="block text-oat mb-1">Conduct</span>
            <input value={conduct} onChange={(e) => setConduct(e.target.value)} className={field} />
          </label>
          <RemarkPicker kind="CONDUCT" score={score} onPick={setConduct} />
        </div>
        <div className="text-[13px]">
          <label className="block">
            <span className="block text-oat mb-1">Interest</span>
            <input
              value={interest}
              onChange={(e) => setInterest(e.target.value)}
              className={field}
            />
          </label>
          <RemarkPicker kind="INTEREST" score={score} onPick={setInterest} />
        </div>
      </div>
      <div className="text-[13px] mt-3">
        <label className="block">
          <span className="block text-oat mb-1">Class teacher&apos;s remark</span>
          <textarea
            rows={2}
            value={teacherRemark}
            onChange={(e) => setTeacherRemark(e.target.value)}
            className={field}
          />
        </label>
        <RemarkPicker kind="TEACHER" score={score} onPick={setTeacherRemark} />
        <AiDraftButton
          studentId={studentId}
          termId={termId}
          kind="TEACHER"
          onDraft={setTeacherRemark}
        />
      </div>
      <div className="text-[13px] mt-3">
        <label className="block">
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
        {isHead && <RemarkPicker kind="HEAD" score={score} onPick={setHeadRemark} />}
        {isHead && (
          <AiDraftButton
            studentId={studentId}
            termId={termId}
            kind="HEAD"
            onDraft={setHeadRemark}
          />
        )}
      </div>
      <div className="flex items-center gap-3 mt-4">
        <Button onClick={save.run} state={save.state} icon={<SaveIcon />}>
          Save remarks
        </Button>
        {/* Only the reason a save failed — the button already says whether it worked. */}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </div>
  );
}
