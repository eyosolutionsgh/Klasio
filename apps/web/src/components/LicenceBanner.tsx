'use client';

import Link from 'next/link';
import { licenceWarning, type LicenceStatus } from '@/lib/licence-warning';
import { AlertIcon } from './icons';

/**
 * A standing warning when the school's licence is lapsing, or has.
 *
 * Without it the only ways to find out were to open Settings → Licence, which nobody does
 * unprompted, or to notice a feature had stopped working — by which point the grace period has
 * already run out and the conversation starts with "why is this broken" rather than "we should
 * renew". A grace period only works if somebody is told during it.
 *
 * Lives in the portal layout rather than on the dashboard so a lapse reaches whoever is next in
 * the portal, not only whoever lands on the front page. It renders nothing in the ordinary case,
 * which is what makes being everywhere affordable — see `licenceWarning`, which owns the decision
 * about when to stay silent.
 */
export default function LicenceBanner({
  status,
  /** Only someone who could actually install a licence is asked to. */
  canManage,
}: {
  status: LicenceStatus | null;
  canManage: boolean;
}) {
  const warning = licenceWarning(status);
  if (!warning) return null;

  const danger = warning.tone === 'danger';

  return (
    <aside
      /*
        A landmark, not a live region.

        `role="status"` was wrong twice over: this banner is server-rendered and present on
        arrival, so a screen reader reads it in document order anyway, and marking it live makes it
        announce *again*, out of order, on every navigation. It also collided with the live regions
        the shared Button already publishes — `getByRole('status')` on any page with two buttons is
        ambiguous, which is a smell worth heeding rather than working around.
      */
      aria-label="Licence notice"
      className={`no-print mb-5 rounded-lg border px-4 py-3 flex gap-3 items-start text-sm ${
        danger ? 'border-danger/30 bg-danger/5 text-danger' : 'border-clay/30 bg-clay/5 text-clay'
      }`}
    >
      <AlertIcon aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{warning.headline}</p>
        <p className={`mt-0.5 leading-relaxed ${danger ? 'text-danger/85' : 'text-clay/85'}`}>
          {warning.detail}
        </p>
        {/*
          Everyone sees the warning — a teacher whose features vanished deserves to know why rather
          than concluding the product is broken — but only someone who can fix it is handed the
          link, because an action a person cannot take is noise dressed up as help.
        */}
        {canManage && (
          <Link
            href="/settings/licence"
            className="mt-1.5 inline-block font-medium underline underline-offset-2 hover:no-underline"
          >
            Install a licence
          </Link>
        )}
      </div>
    </aside>
  );
}
