import { TableSkeleton, SkeletonBar } from '@/components/Loading';

/**
 * Shown while the roles and the permission catalogue are in flight.
 *
 * Four rows, not eight: a school has a handful of roles, and a skeleton twice the height of the
 * table it stands in for makes the page settle upwards when the real rows land.
 */
export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <SkeletonBar w="w-56" className="h-7" />
        <SkeletonBar w="w-96 max-w-full" className="h-3" />
      </div>
      <TableSkeleton rows={4} widths={['w-36', 'w-56', 'w-10', 'w-28']} />
    </div>
  );
}
