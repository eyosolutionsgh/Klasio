import { TableSkeleton, SkeletonBar } from '@/components/Loading';

/**
 * Shown while the field, document and remark definitions are in flight.
 *
 * The page is three stacked sections, so the skeleton is too — sketching only the first would let
 * the second and third headings pop in and shove the page down twice.
 */
export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <SkeletonBar w="w-44" className="h-7" />
        <SkeletonBar w="w-96 max-w-full" className="h-3" />
      </div>
      <TableSkeleton rows={4} widths={['w-36', 'w-20', 'w-24', 'w-14', 'w-24']} />
      <TableSkeleton rows={3} widths={['w-40', 'w-28', 'w-24', 'w-16', 'w-24']} />
      <div className="card space-y-3 p-6">
        <SkeletonBar w="w-40" className="h-5" />
        <SkeletonBar w="w-full" />
        <SkeletonBar w="w-11/12" />
        <SkeletonBar w="w-10/12" />
      </div>
    </div>
  );
}
