import { CardSkeleton, SkeletonBar } from '@/components/Loading';

/**
 * Shown while one child's record is in flight.
 *
 * Deliberately not the register's table skeleton: this page is a header and a two-column run of
 * cards, and standing in for it with rows would settle visibly wrong when the real thing lands.
 * The avatar, name and identifying line are sketched at the sizes the header actually uses so the
 * page does not jump once the student arrives.
 *
 * Nothing here stands in for a specific field. Several of this page's sections — guardian phone
 * numbers, medical notes, the fee figures — are withheld from the response entirely unless the
 * caller holds the permission, so a skeleton shaped like those fields would promise a reader
 * something they may never be shown.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonBar w="w-32" className="h-3" />

      <div className="mt-4 flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-5">
          <span className="block w-16 h-16 rounded-full bg-mist/70 shimmer" aria-hidden />
          <div className="space-y-2.5">
            <SkeletonBar w="w-56" className="h-7" />
            <SkeletonBar w="w-72" className="h-3" />
          </div>
        </div>
        <div className="card px-5 py-3 space-y-2">
          <SkeletonBar w="w-20" className="h-2.5" />
          <SkeletonBar w="w-28" className="h-6" />
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.3fr] gap-6 mt-8">
        <div className="space-y-6">
          <CardSkeleton tiles={2} />
          <CardSkeleton tiles={2} />
        </div>
        <div className="space-y-6">
          <CardSkeleton tiles={2} />
          <CardSkeleton tiles={2} />
        </div>
      </div>
    </div>
  );
}
