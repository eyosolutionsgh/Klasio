import Link from 'next/link';
import type { ClientHealth } from '@/lib/health';
import { HEALTH_ORDER, withParams } from '@/lib/list';

/**
 * The status chips, which are the filter.
 *
 * They were read-only tallies before. Making them the control means the number you noticed and the
 * thing you do about it are the same object — you see "3 need a call" and click the 3, rather than
 * reading it and then hunting for a filter somewhere else.
 *
 * Counts always describe every school, never the page or the current filter, so the chips stay a
 * fixed picture of the estate while the table below them narrows.
 */
export const HEALTH_LABEL: Record<ClientHealth, { label: string; cls: string; on: string }> = {
  ATTENTION: { label: 'Needs a call', cls: 'text-danger', on: 'bg-danger text-white' },
  EXPIRED: { label: 'Expired', cls: 'text-danger', on: 'bg-danger text-white' },
  SILENT: { label: 'Silent', cls: 'text-clay', on: 'bg-clay text-white' },
  EXPIRING: { label: 'Expiring', cls: 'text-clay', on: 'bg-clay text-white' },
  UNLICENSED: { label: 'Awaiting licence', cls: 'text-slate', on: 'bg-slate text-white' },
  OK: { label: 'Active', cls: 'text-leaf', on: 'bg-leaf text-white' },
};

export default function StatusFilter({
  counts,
  active,
  params,
  total,
}: {
  counts: Record<ClientHealth, number>;
  active?: ClientHealth;
  params: Record<string, string | undefined>;
  total: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={withParams(params, { status: undefined, page: undefined })}
        className={`chip border transition-colors ${
          active ? 'border-mist text-slate hover:bg-hush' : 'bg-ink text-white border-ink'
        }`}
      >
        All <span className="tabular-nums opacity-80">{total}</span>
      </Link>

      {HEALTH_ORDER.map((h) => {
        const count = counts[h];
        const isActive = active === h;
        return (
          <Link
            key={h}
            href={withParams(params, {
              // Clicking the chip you are already on clears it, so the control toggles rather
              // than trapping you in a filter you have to find your way out of.
              status: isActive ? undefined : h,
              page: undefined,
            })}
            className={`chip border transition-colors ${
              isActive
                ? `${HEALTH_LABEL[h].on} border-transparent`
                : count === 0
                  ? 'border-mist text-oat/60 hover:bg-hush'
                  : `border-mist ${HEALTH_LABEL[h].cls} hover:bg-hush`
            }`}
          >
            {HEALTH_LABEL[h].label} <span className="tabular-nums opacity-80">{count}</span>
          </Link>
        );
      })}
    </div>
  );
}
