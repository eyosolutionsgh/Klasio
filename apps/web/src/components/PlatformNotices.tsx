'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface Notice {
  id: string;
  subject: string;
  body: string;
  level: 'INFO' | 'WARNING';
  readAt: string | null;
  createdAt: string;
}

/**
 * Messages from EYO to this school.
 *
 * Sits above the page rather than inside Announcements on purpose: an announcement is the
 * school's own voice, written by its head for its staff, and a message from the vendor about
 * money or an outage is neither. Keeping them apart also means the school cannot delete ours and
 * we cannot put words in theirs.
 *
 * Only unread notices are shown. Acknowledging is the school saying "seen", not "agreed", so it
 * is one click with no confirmation — and it does not delete anything, since the whole history
 * stays visible to EYO.
 */
export default function PlatformNotices({ notices }: { notices: Notice[] }) {
  const router = useRouter();
  const [dismissing, setDismissing] = useState<string | null>(null);
  const unread = notices.filter((n) => !n.readAt);
  if (unread.length === 0) return null;

  async function acknowledge(id: string) {
    setDismissing(id);
    await fetch(`/api/proxy/notices/${id}/acknowledge`, { method: 'PATCH' });
    router.refresh();
    setDismissing(null);
  }

  return (
    <div className="space-y-3 mb-6">
      {unread.map((n) => (
        <div
          key={n.id}
          role={n.level === 'WARNING' ? 'alert' : 'status'}
          className={`card p-5 border-l-4 ${n.level === 'WARNING' ? 'border-l-danger' : 'border-l-brand'}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-oat">Message from Klasio</p>
              <p
                className={`text-sm font-medium mt-1 ${n.level === 'WARNING' ? 'text-danger' : 'text-ink'}`}
              >
                {n.subject}
              </p>
              <p className="text-[13px] text-ink/80 mt-1.5 leading-relaxed whitespace-pre-wrap">
                {n.body}
              </p>
            </div>
            <button
              onClick={() => acknowledge(n.id)}
              disabled={dismissing === n.id}
              className="min-h-11 shrink-0 text-[13px] text-oat hover:text-ink transition disabled:opacity-50"
            >
              {dismissing === n.id ? 'Dismissing…' : 'Dismiss'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
