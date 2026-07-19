import { TableSkeleton, SkeletonBar } from '@/components/Loading';

/**
 * Shown while the library is in flight.
 *
 * The column widths mirror the real table — a wide title over its filename, the tags it is
 * shared with, a short open count, a status word, the actions — so the swap to real rows does not
 * visibly reflow. The upload panel beside it is sketched too: skeletoning only the table would
 * let the page settle in two stages.
 */
export default function Loading() {
  return (
    <div>
      <div className="space-y-3">
        <SkeletonBar w="w-64" className="h-7" />
        <SkeletonBar w="w-96" className="h-3" />
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <SkeletonBar w="w-full sm:w-48" className="h-10 rounded-lg" />
        <SkeletonBar w="w-full sm:w-56" className="h-10 rounded-lg" />
        <SkeletonBar w="w-full sm:w-44" className="h-10 rounded-lg" />
      </div>
      <div className="grid lg:grid-cols-[1fr_1.6fr] gap-6 mt-6">
        <div className="card space-y-4 p-6">
          <SkeletonBar w="w-40" className="h-5" />
          <SkeletonBar w="w-full" className="h-10 rounded-lg" />
          <SkeletonBar w="w-full" className="h-10 rounded-lg" />
          <SkeletonBar w="w-32" className="h-10 rounded-lg" />
        </div>
        <TableSkeleton rows={6} widths={['w-44', 'w-28', 'w-10', 'w-20', 'w-16']} />
      </div>
    </div>
  );
}
