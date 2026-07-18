'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
  const [busy, setBusy] = useState(false);

  async function call(path: string, method = 'POST') {
    setBusy(true);
    const res = await fetch(`/api/proxy/resources/${id}${path}`, { method });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete “${title}”? Anyone with the link loses it too.`)) return;
    call('', 'DELETE');
  }

  return (
    <span className="flex items-center gap-3 whitespace-nowrap">
      <button
        onClick={() => call(published ? '/unpublish' : '/publish')}
        disabled={busy}
        className="text-[12px] text-brand hover:underline disabled:opacity-50"
      >
        {published ? 'Unpublish' : 'Publish'}
      </button>
      <button
        onClick={remove}
        disabled={busy}
        className="text-[12px] text-clay hover:underline disabled:opacity-50"
      >
        Delete
      </button>
    </span>
  );
}
