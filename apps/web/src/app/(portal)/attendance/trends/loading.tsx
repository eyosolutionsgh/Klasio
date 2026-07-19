import { TableSkeleton, SkeletonBar } from '@/components/Loading';

/**
 * Shown while a term's registers are being aggregated.
 *
 * The two summary cards are sketched as well as the table, because they sit above it — skeletoning
 * only the chronic list would let the headline rate and the by-class bars pop in first and shove
 * the table down the page just as a reader reached it.
 *
 * Widths mirror the real columns: a wide student name over an admission number, a short class, then
 * two narrow numeric columns.
 */
export default function Loading() {
  return (
    <div>
      <div className="space-y-3">
        <SkeletonBar w="w-32" className="h-2.5" />
        <SkeletonBar w="w-56" className="h-7" />
        <SkeletonBar w="w-72" className="h-3" />
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <SkeletonBar w="w-full sm:w-64" className="h-10 rounded-lg" />
        <SkeletonBar w="w-full sm:w-72" className="h-10 rounded-lg" />
      </div>
      <div className="card mt-6 space-y-3 p-6" role="status" aria-live="polite">
        <span className="sr-only">Loading…</span>
        <SkeletonBar w="w-40" className="h-2.5" />
        <SkeletonBar w="w-24" className="h-9" />
      </div>
      <div className="card mt-6 space-y-4 p-6" aria-hidden>
        <SkeletonBar w="w-28" className="h-5" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-1.5">
            <SkeletonBar w="w-32" className="h-3" />
            <SkeletonBar w="w-full" className="h-2 rounded-full" />
          </div>
        ))}
      </div>
      <TableSkeleton className="mt-6" rows={6} widths={['w-44', 'w-24', 'w-20', 'w-14']} />
    </div>
  );
}
