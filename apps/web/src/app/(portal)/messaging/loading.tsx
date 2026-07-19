import { TableSkeleton, SkeletonBar } from '@/components/Loading';

/**
 * Shown while the credit balance, the composer's classes and the send log are in flight.
 *
 * The composer is sketched as a block rather than as fields: it is a card of a known height, and
 * outlining four choice cards and two text areas would be more detail than the eye can use in the
 * moment before it lands. The table's widths mirror the real columns — a number, a long message, a
 * short status pill, a timestamp — so the swap does not reflow.
 */
export default function Loading() {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-3">
          <SkeletonBar w="w-44" className="h-7" />
          <SkeletonBar w="w-72" className="h-3" />
        </div>
        <SkeletonBar w="w-40" className="h-16 rounded-xl" />
      </div>
      <SkeletonBar w="w-full" className="mt-6 h-64 rounded-2xl" />
      <div className="mt-8 space-y-3">
        <SkeletonBar w="w-40" className="h-5" />
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <SkeletonBar w="w-full sm:w-48" className="h-10 rounded-lg" />
        <SkeletonBar w="w-full sm:w-64" className="h-10 rounded-lg" />
      </div>
      <TableSkeleton className="mt-4" rows={8} widths={['w-28', 'w-64', 'w-16', 'w-24']} />
    </div>
  );
}
