import { TableSkeleton, SkeletonBar } from '@/components/Loading';

/**
 * Shown while the register's data is in flight.
 *
 * The column widths mirror the real table — narrow admission number, wide name, short class, wide
 * guardians — so the swap to real rows does not visibly reflow. The header and filter bar are
 * sketched too: skeletoning only the table would let the chrome pop in first and shift everything
 * down.
 */
export default function Loading() {
  return (
    <div>
      <div className="space-y-3">
        <SkeletonBar w="w-40" className="h-7" />
        <SkeletonBar w="w-72" className="h-3" />
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <SkeletonBar w="w-full sm:w-52" className="h-10 rounded-lg" />
        <SkeletonBar w="w-full sm:w-64" className="h-10 rounded-lg" />
        <SkeletonBar w="w-full sm:w-40" className="h-10 rounded-lg" />
      </div>
      <TableSkeleton className="mt-6" rows={8} widths={['w-20', 'w-44', 'w-24', 'w-52']} />
    </div>
  );
}
