import { TableSkeleton, SkeletonBar } from '@/components/Loading';

/**
 * Shown while a class's terminal reports are fetched.
 *
 * The action row is sketched at button height rather than field height — Generate, Publish and the
 * export links sit on the same line as the class picker, and a placeholder that ignored them would
 * let the row grow taller the moment the real controls arrived.
 *
 * Widths mirror the real columns: a short position, a wide student name over an admission number, a
 * narrow total, then the link to the report itself.
 */
export default function Loading() {
  return (
    <div>
      <div className="space-y-3">
        <SkeletonBar w="w-56" className="h-7" />
        <SkeletonBar w="w-80" className="h-3" />
      </div>
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <SkeletonBar w="w-full sm:w-56" className="h-10 rounded-lg" />
        <SkeletonBar w="w-full sm:w-44" className="h-10 rounded-lg" />
        <SkeletonBar w="w-40" className="h-10 rounded-lg" />
        <SkeletonBar w="w-36" className="h-10 rounded-lg" />
      </div>
      <TableSkeleton className="mt-6" rows={8} widths={['w-14', 'w-44', 'w-16', 'w-32']} />
    </div>
  );
}
