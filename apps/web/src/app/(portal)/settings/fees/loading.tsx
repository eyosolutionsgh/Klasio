import { SkeletonBar, TableSkeleton } from '@/components/Loading';

/**
 * The fee structure loads its term, levels and items in sequence from the client, so the wait
 * here is longer than most. The skeleton sketches the structure table and the two forms beneath
 * it — the forms are tall, and letting them appear after the table would push it up the screen
 * just as the bursar started reading it.
 */
export default function Loading() {
  return (
    <div>
      <div className="space-y-3">
        <SkeletonBar w="w-52" className="h-7" />
        <SkeletonBar w="w-full max-w-2xl" className="h-3" />
      </div>

      <TableSkeleton className="mt-6" rows={4} widths={['w-36', 'w-24', 'w-20', 'w-24']} />

      <div className="card mt-6 max-w-2xl space-y-4 p-6">
        <SkeletonBar w="w-40" className="h-5" />
        <div className="flex flex-wrap gap-3">
          <SkeletonBar w="w-48" className="h-10 rounded-lg" />
          <SkeletonBar w="w-32" className="h-10 rounded-lg" />
          <SkeletonBar w="w-40" className="h-10 rounded-lg" />
        </div>
      </div>

      <div className="card mt-6 max-w-2xl space-y-4 p-6">
        <SkeletonBar w="w-44" className="h-5" />
        <SkeletonBar w="w-full" className="h-3" />
        <SkeletonBar w="w-56" className="h-10 rounded-lg" />
      </div>
    </div>
  );
}
