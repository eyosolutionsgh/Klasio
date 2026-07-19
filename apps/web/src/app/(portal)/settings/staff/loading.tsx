import { TableSkeleton, SkeletonBar } from '@/components/Loading';

/**
 * Shown while the staff list is in flight.
 *
 * The widths follow the real columns — name, a wider email, two role columns, a short status
 * pill and the actions — so the filter bar and table do not jump when the accounts arrive. The
 * page also reads its filters from the URL, which needs a Suspense boundary above it; this file
 * is what provides one.
 */
export default function Loading() {
  return (
    <div>
      <div className="space-y-3">
        <SkeletonBar w="w-48" className="h-7" />
        <SkeletonBar w="w-80" className="h-3" />
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <SkeletonBar w="w-full sm:w-40" className="h-10 rounded-lg" />
        <SkeletonBar w="w-full sm:w-40" className="h-10 rounded-lg" />
        <SkeletonBar w="w-full sm:w-56" className="h-10 rounded-lg" />
      </div>
      <TableSkeleton
        className="mt-6"
        rows={8}
        widths={['w-32', 'w-44', 'w-28', 'w-32', 'w-16', 'w-24']}
      />
    </div>
  );
}
