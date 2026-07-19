import { CardSkeleton, TableSkeleton, SkeletonBar } from '@/components/Loading';

/**
 * Shown while the exception queue is in flight.
 *
 * The four headline tiles are sketched as well as the table: they come from their own summary
 * call, so they can land at a different moment, and leaving them out would let the queue render
 * first and then shove itself down the page when the counts arrive.
 *
 * Widths mirror the real columns — a long tabular reference, a name, two money columns, a short
 * state pill.
 */
export default function Loading() {
  return (
    <div>
      <div className="space-y-3">
        <SkeletonBar w="w-72" className="h-7" />
        <SkeletonBar w="w-full max-w-xl" className="h-3" />
      </div>
      <div className="mt-6">
        <CardSkeleton tiles={4} />
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <SkeletonBar w="w-full sm:w-64" className="h-10 rounded-lg" />
        <SkeletonBar w="w-full sm:w-52" className="h-10 rounded-lg" />
      </div>
      <TableSkeleton className="mt-4" rows={6} widths={['w-32', 'w-40', 'w-24', 'w-24', 'w-20']} />
    </div>
  );
}
