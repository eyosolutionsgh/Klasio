import { TableSkeleton, SkeletonBar } from '@/components/Loading';

/**
 * Shown while the connected gateways are in flight.
 *
 * Two rows, because that is the most this table can hold — one per provider. Sketching eight would
 * promise a list that never arrives.
 */
export default function Loading() {
  return (
    <div>
      <div className="space-y-3">
        <SkeletonBar w="w-52" className="h-7" />
        <SkeletonBar w="w-96 max-w-full" className="h-3" />
      </div>
      <TableSkeleton className="mt-6" rows={2} widths={['w-24', 'w-16', 'w-44', 'w-20']} />
      <div className="card mt-6 max-w-xl space-y-4 p-6">
        <SkeletonBar w="w-44" className="h-5" />
        <SkeletonBar w="w-full" className="h-10 rounded-lg" />
        <SkeletonBar w="w-full" className="h-10 rounded-lg" />
      </div>
    </div>
  );
}
