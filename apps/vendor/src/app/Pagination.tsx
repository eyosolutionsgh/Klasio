import Link from 'next/link';
import { withParams } from '@/lib/list';

/**
 * Previous and next, with the range spelled out.
 *
 * No numbered pages: they earn their place when someone wants a particular page, and nobody wants
 * page 7 of a client list — they want the school, which the search box above finds in one go.
 * "Showing 26–50 of 112" is the part that actually orients you.
 */
export default function Pagination({
  page,
  pageCount,
  from,
  to,
  total,
  params,
}: {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  params: Record<string, string | undefined>;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3 border-t border-mist text-sm">
      <p className="text-slate tabular-nums">
        Showing {from}–{to} of {total}
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-oat text-xs tabular-nums">
            Page {page} of {pageCount}
          </span>
          {page > 1 ? (
            <Link href={withParams(params, { page: page - 1 })} className="btn btn-quiet h-9 px-3">
              Previous
            </Link>
          ) : (
            // Rendered rather than hidden, so the pair keeps its width and Next stays put as you page.
            <span className="btn btn-quiet h-9 px-3 opacity-40 cursor-default">Previous</span>
          )}
          {page < pageCount ? (
            <Link href={withParams(params, { page: page + 1 })} className="btn btn-quiet h-9 px-3">
              Next
            </Link>
          ) : (
            <span className="btn btn-quiet h-9 px-3 opacity-40 cursor-default">Next</span>
          )}
        </div>
      )}
    </div>
  );
}
