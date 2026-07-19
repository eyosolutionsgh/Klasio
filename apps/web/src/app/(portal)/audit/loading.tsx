import { TableSkeleton, SkeletonBar } from '@/components/Loading';

/**
 * Shown while the trail is in flight.
 *
 * The column widths mirror the real table — a short timestamp, a name, a long dotted action, a
 * short entity, a wide detail blob — so the swap to real rows does not visibly reflow. The heading
 * and filter row are sketched too: skeletoning only the table would let the chrome pop in first
 * and shift everything down.
 */
export default function Loading() {
  return (
    <div>
      <div className="space-y-3">
        <SkeletonBar w="w-40" className="h-7" />
        <SkeletonBar w="w-80" className="h-3" />
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <SkeletonBar w="w-full sm:w-64" className="h-10 rounded-lg" />
        <SkeletonBar w="w-full sm:w-52" className="h-10 rounded-lg" />
        <SkeletonBar w="w-full sm:w-64" className="h-10 rounded-lg" />
      </div>
      <TableSkeleton className="mt-6" rows={10} widths={['w-24', 'w-28', 'w-40', 'w-24', 'w-56']} />
    </div>
  );
}
