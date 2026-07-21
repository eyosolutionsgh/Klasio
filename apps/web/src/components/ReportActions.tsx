'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useAsyncAction } from './Button';
import { RefreshIcon } from './icons';

/**
 * Generate, publish and unpublish a class's terminal reports.
 *
 * These are the only parts of the reports page that are not a link: everything else — the class,
 * the publication filter, the sort, the page, the broadsheet — is now a URL the server renders
 * from. After a write, `router.refresh()` re-runs the server component so the freshly generated
 * rows and their new published badges arrive without this component holding a copy of the list.
 *
 * `unpublishedCount` comes from a count over the whole class, not from the rows on screen. Publish
 * acts on every report in the class and term, so a page showing 25 of 40 must not decide from those
 * 25 whether the class is fully published — offering "Unpublish" on page 1 while page 2 had never
 * been released would have been a lie about what the button was about to do.
 *
 * Regenerating over published reports is the one action here that reaches families who have
 * already read something. The API refuses it unless the caller states `regeneratePublished`, and
 * for a while nothing in the UI could state it — so a head who genuinely needed to correct a
 * marking error could only ever read the refusal. The confirmation below is that missing half:
 * it names how many families are affected before it will send the flag.
 */
export default function ReportActions({
  classId,
  termId,
  total,
  unpublishedCount,
  publishedCount,
}: {
  classId: string;
  termId: string;
  /** Reports in this class and term, across every page. */
  total: number;
  unpublishedCount: number;
  /** Reports already released to families — what makes regeneration consequential. */
  publishedCount: number;
}) {
  const router = useRouter();
  // Failures only — the buttons report their own success.
  const [error, setError] = useState<string | null>(null);
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);

  async function post(path: string, body: unknown, fallback: string) {
    setError(null);
    const res = await fetch(`/api/proxy/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // The server's reason — "these are already published", a missing scheme — is what the user
      // has to act on; the button can only say it did not work.
      setError(Array.isArray(data.message) ? data.message.join('. ') : (data.message ?? fallback));
      throw new Error('rejected');
    }
    router.refresh();
  }

  const generate = useAsyncAction(() =>
    post('assessment/reports/generate', { classId, termId }, 'Could not generate reports.'),
  );
  /**
   * The same endpoint, with the school's consent attached. Separate from `generate` so the
   * confirmation button wears its own pending and done state, and so the flag can never ride
   * along on the ordinary path by accident.
   */
  const regenerate = useAsyncAction(async () => {
    await post(
      'assessment/reports/generate',
      { classId, termId, regeneratePublished: true },
      'Could not regenerate reports.',
    );
    setConfirmingRegenerate(false);
  });
  /*
    Two hooks rather than one with an argument: a successful publish swaps this button for its
    opposite as soon as the server rows come back, and a shared state would leave the newcomer
    wearing the outcome of an action it did not perform.
  */
  const publish = useAsyncAction(() =>
    post(
      'assessment/reports/publish',
      { classId, termId, published: true },
      'Could not publish these reports.',
    ),
  );
  const unpublish = useAsyncAction(() =>
    post(
      'assessment/reports/publish',
      { classId, termId, published: false },
      'Could not retract these reports.',
    ),
  );

  const allPublished = total > 0 && unpublishedCount === 0;

  if (confirmingRegenerate) {
    /* The stop: counts the families before it will overwrite what they have already read. */
    return (
      <div className="w-full rounded-lg border border-danger/30 bg-danger/5 p-4">
        <p className="font-medium text-danger">
          Replace {publishedCount} published report{publishedCount === 1 ? '' : 's'}?
        </p>
        <p className="text-[13px] text-oat mt-1.5 max-w-prose">
          {publishedCount === 1 ? 'One family has' : `${publishedCount} families have`} already been
          able to read {publishedCount === 1 ? 'this report' : 'these reports'}. Regenerating
          recomputes every mark, grade and position from the saved scores and replaces what they
          saw. <span className="text-ink">Do this when a marking error needs correcting</span> — the
          reports stay published, so the corrected version reaches them straight away.
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <Button
            onClick={regenerate.run}
            state={regenerate.state}
            variant="danger"
            pendingLabel="Regenerating…"
            doneLabel="Regenerated!"
            failedLabel="Couldn't regenerate"
          >
            {`Yes, replace ${publishedCount}`}
          </Button>
          <button
            onClick={() => setConfirmingRegenerate(false)}
            className="min-h-11 px-3 text-sm text-oat hover:text-brand transition"
          >
            Cancel
          </button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger mt-3">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <Button
        /* With nothing published yet this is an ordinary recompute; once families have read a
           report it becomes a decision, so it routes through the confirmation instead. */
        onClick={publishedCount > 0 ? () => setConfirmingRegenerate(true) : generate.run}
        state={generate.state}
        disabled={!classId}
        icon={<RefreshIcon />}
        data-tip={
          publishedCount > 0
            ? `Recomputes every report — ${publishedCount} already published, so it will ask first`
            : 'Recomputes every report in this class from the latest scores'
        }
        className="tip"
      >
        Generate reports
      </Button>
      {total > 0 &&
        (allPublished ? (
          /* Secondary, not danger: retracting is reversible and re-opens the remarks. */
          <Button
            onClick={unpublish.run}
            state={unpublish.state}
            variant="secondary"
            pendingLabel="Unpublishing…"
            doneLabel="Unpublished!"
            failedLabel="Couldn't unpublish"
            data-tip="Retract from guardians and re-open remarks for editing"
            className="tip"
          >
            Unpublish
          </Button>
        ) : (
          <Button
            onClick={publish.run}
            state={publish.state}
            data-tip={`Release all ${total} reports in this class to guardians`}
            className="tip"
          >
            Publish reports
          </Button>
        ))}
      {/* Kept: the button can only say it failed, the server says why. */}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}
