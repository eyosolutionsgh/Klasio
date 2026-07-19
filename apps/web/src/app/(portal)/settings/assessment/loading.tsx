import { TableSkeleton, SkeletonBar } from '@/components/Loading';

/**
 * Shown while the school's assessment configuration is fetched.
 *
 * This page is four stacked cards, and the assessments table is the third of them — so the two
 * above it are sketched at roughly their real heights. Skeletoning only the table would let the
 * weighting card land first and push the table down past where a reader had already looked.
 *
 * Widths mirror the real columns: a wide assessment name, a narrow maximum, a short category pill,
 * a wide scope sentence, and the Remove button.
 */
export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <SkeletonBar w="w-56" className="h-7" />
        <SkeletonBar w="w-80" className="h-3" />
      </div>

      <div className="card space-y-4 p-6" role="status" aria-live="polite">
        <span className="sr-only">Loading…</span>
        <SkeletonBar w="w-32" className="h-5" />
        <SkeletonBar w="w-72" className="h-3" />
        <div className="flex flex-wrap gap-3">
          <SkeletonBar w="w-24" className="h-10 rounded-lg" />
          <SkeletonBar w="w-24" className="h-10 rounded-lg" />
          <SkeletonBar w="w-36" className="h-10 rounded-lg" />
        </div>
      </div>

      <div className="space-y-4" aria-hidden>
        <SkeletonBar w="w-36" className="h-5" />
        <TableSkeleton rows={5} widths={['w-40', 'w-10', 'w-20', 'w-44', 'w-24']} />
      </div>

      <div className="card space-y-3 p-6" aria-hidden>
        <SkeletonBar w="w-44" className="h-5" />
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-wrap gap-1.5">
            {[0, 1, 2, 3, 4, 5].map((j) => (
              <SkeletonBar key={j} w="w-20" className="h-5 rounded-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
