import Image from 'next/image';

/**
 * The waiting states.
 *
 * Two different things, on purpose. A **skeleton** stands in for content whose shape we already
 * know — a table has rows, a form has fields — and holding that shape stops the page jumping when
 * the real rows land. The **emblem** is for waits where we know nothing about what is coming, or
 * where the wait is the whole screen. Using the animated mark as a row placeholder would be
 * twenty copies of the same spinning logo, which reads as an error rather than as progress.
 *
 * Everything here is decorative to assistive tech: the mark is `alt=""` and the live region says
 * "Loading…" once. A screen-reader user should hear that the page is working, not hear a
 * description of grey rectangles.
 */

/** The animated Klasio emblem. Rendered at half its pixel size so it stays crisp on retina. */
export function KlasioLoader({
  size = 64,
  label = 'Loading…',
  className = '',
}: {
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 ${className}`}
      role="status"
      aria-live="polite"
    >
      <Image
        src="/brand/loader.gif"
        alt=""
        width={size}
        height={size}
        // The emblem is the first thing on a cold page load; letting Next lazy-load it means the
        // spinner itself arrives late, which is the one asset that must not.
        priority
        unoptimized
        style={{ width: size, height: size }}
      />
      <p className="text-sm text-oat">{label}</p>
    </div>
  );
}

/** A full-page wait — what a route's `loading.tsx` shows before anything is known. */
export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <KlasioLoader label={label} />
    </div>
  );
}

/**
 * One shimmering bar. `w` is a Tailwind width class so callers can vary the widths down a column —
 * a skeleton whose every bar is the same length looks like a loading bar, not like text.
 */
export function SkeletonBar({ w = 'w-24', className = '' }: { w?: string; className?: string }) {
  return (
    <span className={`block h-3.5 rounded bg-mist/70 shimmer ${w} ${className}`} aria-hidden />
  );
}

/**
 * A table's worth of placeholder rows, matching the real table's chrome so the swap is quiet.
 *
 * `widths` lets a caller describe the column shape — a narrow admission number beside a wide name
 * beside a short class. Defaulting every column to the same width would make the skeleton settle
 * visibly wrong when the real content arrives.
 */
export function TableSkeleton({
  columns = 4,
  rows = 8,
  widths,
  className = '',
}: {
  columns?: number;
  rows?: number;
  widths?: string[];
  className?: string;
}) {
  const cols = widths?.length ? widths : Array.from({ length: columns }, () => 'w-24');
  return (
    <div className={`card overflow-hidden ${className}`} role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="border-b border-mist bg-parchment/50 px-5 py-3.5">
        <div className="flex gap-6">
          {cols.map((w, i) => (
            <SkeletonBar key={i} w={w} className="h-2.5 opacity-70" />
          ))}
        </div>
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-6 border-b border-mist/60 px-5 py-4 last:border-0">
          {cols.map((w, i) => (
            // Alternating widths down the column keeps the block from looking like a grid of
            // identical bars — real data is ragged.
            <SkeletonBar key={i} w={w} className={r % 2 === 1 && i > 0 ? 'opacity-70' : ''} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Placeholder for the stat tiles that head several of the portal's pages. */
export function CardSkeleton({ tiles = 3 }: { tiles?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: tiles }).map((_, i) => (
        <div key={i} className="card space-y-3 p-5">
          <SkeletonBar w="w-20" className="h-2.5" />
          <SkeletonBar w="w-28" className="h-6" />
        </div>
      ))}
    </div>
  );
}
