import { TableSkeleton, SkeletonBar } from '@/components/Loading';

/**
 * Shown while a class's or a teacher's week is fetched.
 *
 * Six columns — the period label and five weekdays — because that is what the grid resolves to, and
 * a four-column placeholder would visibly widen as the real days arrived. The period column is the
 * wide one; the day columns are equal, which is what an empty week actually looks like.
 *
 * The rows are deliberately few: a school day is a handful of periods, not a page of records.
 */
export default function Loading() {
  return (
    <div>
      <div className="space-y-3">
        <SkeletonBar w="w-40" className="h-7" />
        <SkeletonBar w="w-80" className="h-3" />
      </div>
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <SkeletonBar w="w-full sm:w-72" className="h-14 rounded-lg" />
        <SkeletonBar w="w-full sm:w-60" className="h-10 rounded-lg" />
      </div>
      <TableSkeleton
        className="mt-5"
        rows={6}
        widths={['w-28', 'w-20', 'w-20', 'w-20', 'w-20', 'w-20']}
      />
    </div>
  );
}
