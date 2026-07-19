'use client';

import { useRouter } from 'next/navigation';
import { Button, useAsyncAction } from './Button';
import { TrashIcon } from './icons';

/**
 * Publishing is the moment a file becomes visible to families, so it is its own button rather
 * than a checkbox that could be flipped by accident while editing something else.
 */
export default function ResourceActions({
  id,
  title,
  published,
}: {
  id: string;
  title: string;
  published: boolean;
}) {
  const router = useRouter();

  async function call(path: string, method = 'POST') {
    const res = await fetch(`/api/proxy/resources/${id}${path}`, { method });
    // The button may only show a tick for a request that actually landed.
    if (!res.ok) throw new Error('rejected');
    router.refresh();
  }

  const publish = useAsyncAction(() => call(published ? '/unpublish' : '/publish'));
  const remove = useAsyncAction(() => call('', 'DELETE'));

  return (
    <span className="flex items-center gap-3 whitespace-nowrap">
      {/* "Unpublish" is not a verb the labels know, so its wording is spelled out. */}
      <Button
        onClick={publish.run}
        state={publish.state}
        variant="ghost"
        size="sm"
        pendingLabel={published ? 'Unpublishing…' : 'Publishing…'}
        doneLabel={published ? 'Unpublished!' : 'Published!'}
        failedLabel={published ? "Couldn't unpublish" : "Couldn't publish"}
      >
        {published ? 'Unpublish' : 'Publish'}
      </Button>
      {/* The confirm stays outside `run`, so backing out of it does not read as a success. */}
      <Button
        onClick={() => {
          if (!confirm(`Delete “${title}”? Anyone with the link loses it too.`)) return;
          remove.run();
        }}
        state={remove.state}
        variant="danger"
        size="sm"
        icon={<TrashIcon />}
      >
        Delete
      </Button>
    </span>
  );
}
