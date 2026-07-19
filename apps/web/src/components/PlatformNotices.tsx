'use client';

import { useRouter } from 'next/navigation';
import { Button, useAsyncAction } from '@/components/Button';

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
  const unread = notices.filter((n) => !n.readAt);
  if (unread.length === 0) return null;

  return (
    <div className="space-y-3 mb-6">
      {unread.map((n) => (
        <NoticeCard key={n.id} notice={n} />
      ))}
    </div>
  );
}

/**
 * One notice and its acknowledgement.
 *
 * Split out so each row owns its own action state — a hook cannot be called per item from inside
 * the list, and a single shared "which id is dismissing" flag is what that constraint used to
 * force.
 */
function NoticeCard({ notice: n }: { notice: Notice }) {
  const router = useRouter();

  const acknowledge = useAsyncAction(async () => {
    const res = await fetch(`/api/proxy/notices/${n.id}/acknowledge`, { method: 'PATCH' });
    // Without this the button ticks for a notice the server never marked read, and the next
    // refresh brings it straight back — which reads as the dismissal being ignored.
    if (!res.ok) throw new Error('acknowledge rejected');
    router.refresh();
  });

  return (
    <div
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
        <Button
          onClick={acknowledge.run}
          state={acknowledge.state}
          variant="ghost"
          size="sm"
          className="shrink-0"
          pendingLabel="Dismissing…"
          doneLabel="Dismissed"
          failedLabel="Couldn't dismiss"
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
