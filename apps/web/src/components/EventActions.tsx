'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Removing an event is one click, so it asks first — families may already have been told. */
export default function EventActions({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!confirm(`Remove “${title}” from the calendar?`)) return;
    setBusy(true);
    const res = await fetch(`/api/proxy/calendar/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <button
      onClick={remove}
      disabled={busy}
      className="text-[12px] text-clay hover:underline disabled:opacity-50 whitespace-nowrap"
    >
      {busy ? 'Removing…' : 'Remove'}
    </button>
  );
}
