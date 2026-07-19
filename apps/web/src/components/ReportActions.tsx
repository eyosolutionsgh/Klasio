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
 */
export default function ReportActions({
  classId,
  termId,
  total,
  unpublishedCount,
}: {
  classId: string;
  termId: string;
  /** Reports in this class and term, across every page. */
  total: number;
  unpublishedCount: number;
}) {
  const router = useRouter();
  // Failures only — the buttons report their own success.
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      <Button
        onClick={generate.run}
        state={generate.state}
        disabled={!classId}
        icon={<RefreshIcon />}
        data-tip="Recomputes every report in this class from the latest scores"
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
