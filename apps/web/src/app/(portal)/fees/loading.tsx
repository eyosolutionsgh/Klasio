import { CardSkeleton, TableSkeleton, SkeletonBar } from '@/components/Loading';

/**
 * Shown while the term's fees are in flight.
 *
 * The four money tiles are sketched above the table because they are the slowest part of the page
 * — the outstanding figure is folded out of the whole school's ledger — and they sit at the top,
 * so leaving them out would let the defaulter list paint first and then be pushed down.
 *
 * Column widths mirror the real table: a wide student cell carrying the admission number under the
 * name, a short class, a money column, and the actions.
 */
export default function Loading() {
  return (
    <div>
      <div className="space-y-3">
        <SkeletonBar w="w-28" className="h-7" />
        <SkeletonBar w="w-80" className="h-3" />
      </div>
      <div className="mt-6">
        <CardSkeleton tiles={4} />
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <SkeletonBar w="w-full sm:w-64" className="h-10 rounded-lg" />
        <SkeletonBar w="w-full sm:w-56" className="h-10 rounded-lg" />
      </div>
      <TableSkeleton className="mt-4" rows={8} widths={['w-44', 'w-20', 'w-24', 'w-40']} />
    </div>
  );
}
