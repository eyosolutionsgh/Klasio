import { CardSkeleton, SkeletonBar, TableSkeleton } from '@/components/Loading';

/**
 * The subscription page is mostly stat tiles and three plan cards, with the invoice history at
 * the foot — so the skeleton is shaped that way rather than as a table. Sketching the plan cards
 * matters more than the table here: they are the tallest thing on the page, and letting them pop
 * in would shove the invoice list a screen and a half down after it had already been read.
 */
export default function Loading() {
  return (
    <div>
      <div className="space-y-3">
        <SkeletonBar w="w-48" className="h-7" />
        <SkeletonBar w="w-full max-w-xl" className="h-3" />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card space-y-3 p-5">
            <SkeletonBar w="w-24" className="h-2.5" />
            <SkeletonBar w="w-20" className="h-6" />
          </div>
        ))}
      </div>

      <div className="mt-8">
        <CardSkeleton tiles={3} />
      </div>

      <TableSkeleton
        className="mt-8"
        rows={5}
        widths={['w-24', 'w-16', 'w-40', 'w-14', 'w-20', 'w-16']}
      />
    </div>
  );
}
