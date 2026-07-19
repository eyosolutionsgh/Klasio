import { TableSkeleton, SkeletonBar } from '@/components/Loading';

/**
 * Shown while the marks sheet is being set up.
 *
 * One wide student column and a run of narrow score boxes — the real grid's shape, so the class
 * pickers above do not jump down the page when the columns for this subject arrive. How many score
 * columns there are depends on the assessments the school runs, so four is a stand-in; the widths
 * that matter are the wide first column against the narrow rest.
 */
export default function Loading() {
  return (
    <div>
      <div className="space-y-3">
        <SkeletonBar w="w-44" className="h-7" />
        <SkeletonBar w="w-80" className="h-3" />
      </div>
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <SkeletonBar w="w-full sm:w-56" className="h-10 rounded-lg" />
        <SkeletonBar w="w-full sm:w-56" className="h-10 rounded-lg" />
      </div>
      <div className="mt-5">
        <SkeletonBar w="w-40" className="h-9 rounded-lg" />
      </div>
      <TableSkeleton className="mt-3" rows={10} widths={['w-44', 'w-10', 'w-10', 'w-10', 'w-10']} />
    </div>
  );
}
