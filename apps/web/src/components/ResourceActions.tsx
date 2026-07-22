'use client';

import { useRouter } from 'next/navigation';
import RowMenu from './RowMenu';
import { TrashIcon } from './icons';

/**
 * Publishing is the moment a file becomes visible to families, so it is its own item rather than
 * a checkbox that could be flipped by accident while editing something else.
 *
 * Both actions live in the row's menu now, and deleting asks inside it. It used to ask through
 * `window.confirm`, which embedded browsers suppress — and a suppressed confirm returns false, so
 * the delete quietly did nothing at all there.
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
    // The menu may only report done for a request that actually landed.
    if (!res.ok) throw new Error('rejected');
    router.refresh();
  }

  return (
    <RowMenu
      label={title}
      actions={[
        {
          // "Unpublish" is not a verb the shared labels know, so its wording is spelled out.
          label: published ? 'Unpublish' : 'Publish to families',
          pendingLabel: published ? 'Unpublishing…' : 'Publishing…',
          doneLabel: published ? 'Unpublished!' : 'Published!',
          failedLabel: published ? "Couldn't unpublish" : "Couldn't publish",
          onSelect: () => call(published ? '/unpublish' : '/publish'),
        },
        {
          label: 'Delete this resource',
          icon: <TrashIcon />,
          danger: true,
          confirm: `Delete “${title}”? Anyone who already has the link loses it too.`,
          confirmLabel: 'Yes, delete it',
          pendingLabel: 'Deleting…',
          doneLabel: 'Deleted',
          onSelect: () => call('', 'DELETE'),
        },
      ]}
    />
  );
}
