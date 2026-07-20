import { ENTITLEMENT_CATALOGUE } from '@eyo/shared';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/session';
import Header from '../Header';
import ArchiveToggle from './ArchiveToggle';
import PackageEditor from './PackageEditor';

export const dynamic = 'force-dynamic';

/**
 * The product list — what a school can be sold.
 *
 * Its own page rather than a section of the issue form, because building a product and selling one
 * are different jobs done by different people at different times. Somebody issuing a licence
 * should be choosing from a menu, not composing one.
 */
export default async function PackagesPage() {
  // Redirects to the sign-in step they are actually at, rather than always to the start.
  await requireUser();

  const packages = await db.package.findMany({
    orderBy: [{ archived: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { licences: true } } },
  });

  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold">Packages</h1>
            <p className="text-sm text-slate mt-0.5">
              What a school buys. Choose the features once here, and issuing a licence is picking a
              name.
            </p>
          </div>
          <PackageEditor catalogue={ENTITLEMENT_CATALOGUE} />
        </div>

        {packages.length === 0 ? (
          <p className="card mt-6 px-5 py-8 text-center text-sm text-slate">
            Build the first package to start issuing licences against it.
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {packages.map((p) => (
              <li key={p.id} className={`card p-5 ${p.archived ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <h2 className="font-semibold flex items-center gap-2">
                      {p.name}
                      <span className="pill bg-hush text-slate">{p.tier}</span>
                      {p.archived && <span className="pill bg-clay/10 text-clay">Withdrawn</span>}
                    </h2>
                    {p.description && <p className="text-sm text-slate mt-1">{p.description}</p>}
                    <p className="text-xs text-oat mt-1 tabular-nums">
                      {p.entitlements.length} feature{p.entitlements.length === 1 ? '' : 's'} ·{' '}
                      {p._count.licences} licence{p._count.licences === 1 ? '' : 's'} issued
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {/* Withdrawing is not an edit, so it lives on the card rather than inside one. */}
                    <ArchiveToggle id={p.id} archived={p.archived} />
                    <PackageEditor
                      catalogue={ENTITLEMENT_CATALOGUE}
                      existing={{
                        id: p.id,
                        name: p.name,
                        description: p.description ?? '',
                        tier: p.tier,
                        entitlements: p.entitlements,
                        archived: p.archived,
                      }}
                    />
                  </div>
                </div>

                {/*
                  Named, not coded. Whoever reads this is deciding what to sell, and "ai.remarks"
                  needs looking up where "AI report remarks" does not.
                */}
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {p.entitlements.map((code) => (
                    <li
                      key={code}
                      title={code}
                      className="text-[11px] rounded-full bg-hush text-slate px-2 py-0.5"
                    >
                      {ENTITLEMENT_CATALOGUE.find((e) => e.code === code)?.label ?? code}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
