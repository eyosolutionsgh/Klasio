import { SkeletonBar, TableSkeleton } from '@/components/Loading';

/**
 * A statutory return reconstructs its own term's roll rather than reading today's, so it is one
 * of the slower pages in the portal. The head block and the stat tiles are sketched alongside the
 * enrolment table because the figures above it are what a head teacher actually reads first.
 */
export default function Loading() {
  return (
    <div>
      <div className="space-y-3">
        <SkeletonBar w="w-56" className="h-7" />
        <SkeletonBar w="w-full max-w-xl" className="h-3" />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card space-y-3 p-5">
            <SkeletonBar w="w-24" className="h-2.5" />
            <SkeletonBar w="w-16" className="h-6" />
          </div>
        ))}
      </div>

      <SkeletonBar w="w-64" className="mt-8 h-5" />
      <TableSkeleton className="mt-3" rows={6} widths={['w-24', 'w-28', 'w-10', 'w-10', 'w-12']} />
    </div>
  );
}
