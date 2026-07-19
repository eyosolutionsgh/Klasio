import { TableSkeleton, SkeletonBar } from '@/components/Loading';

/**
 * Shown while the console route itself is arriving.
 *
 * The console fetches from the browser rather than on the server, so this covers the wait before
 * any of its code runs; the same `TableSkeleton` stands in again inside the page while the schools
 * request is in flight. Both, because they are two different waits and skipping the first one
 * leaves the vendor looking at the dark header strip and nothing else.
 *
 * The dark header is drawn for real rather than sketched — it is static chrome, and a grey bar
 * where the brand strip belongs looks like a broken page rather than a loading one.
 */
export default function Loading() {
  return (
    <main className="min-h-dvh">
      <header className="bg-forest-deep text-paper">
        <div className="accent-rule h-[3px]" />
        <div className="max-w-6xl mx-auto px-6 py-5">
          <p className="text-[11px] uppercase tracking-widest text-paper/50">Klasio Platform</p>
          <h1 className="font-display text-2xl">Schools</h1>
        </div>
      </header>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex gap-6 border-b border-mist pb-3">
          <SkeletonBar w="w-20" className="h-3" />
          <SkeletonBar w="w-24" className="h-3" />
        </div>
        <div className="mt-6 flex items-center gap-3">
          <SkeletonBar w="w-full max-w-sm" className="h-11 rounded-lg" />
          <SkeletonBar w="w-20" className="h-3" />
        </div>
        <TableSkeleton
          className="mt-4"
          rows={6}
          widths={['w-48', 'w-20', 'w-12', 'w-10', 'w-20', 'w-24']}
        />
      </div>
    </main>
  );
}
