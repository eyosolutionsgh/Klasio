import Link from 'next/link';
import { getMe } from '@/lib/api';
import StaffRegister from '@/components/StaffRegister';
import LeavePanel from '@/components/LeavePanel';

/**
 * Staff attendance and leave. The register needs the hr.attendance permission; asking for your
 * own leave needs nothing, so the page renders for any member of staff whose package includes
 * the feature.
 */
export default async function StaffAttendancePage() {
  const me = await getMe();

  if (!me.entitlements.includes('hr.attendance')) {
    return (
      <div>
        <div className="rise rise-1">
          <Link href="/attendance" className="text-[13px] text-oat hover:text-brand transition">
            ← Back to the register
          </Link>
          <h1 className="font-display text-3xl mt-3">Staff attendance &amp; leave</h1>
        </div>
        <p className="card p-6 mt-6 text-sm text-oat rise rise-2">
          Staff attendance and leave are part of a higher package — the pupil register stays
          available on every package. Ask whoever manages your subscription about an upgrade.
        </p>
      </div>
    );
  }

  const perms = me.permissions ?? [];
  const canMark = perms.includes('hr.attendance') || me.user.role === 'OWNER';
  const canDecide = perms.includes('hr.leave') || me.user.role === 'OWNER';

  return (
    <div>
      <div className="rise rise-1">
        <Link href="/attendance" className="text-[13px] text-oat hover:text-brand transition">
          ← Back to the register
        </Link>
        <h1 className="font-display text-3xl mt-3">Staff attendance &amp; leave</h1>
        <p className="text-sm text-oat mt-1.5">
          One mark per person per day, and leave decided by somebody other than whoever asked.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-6 mt-6">
        {canMark ? (
          <StaffRegister />
        ) : (
          <p className="card p-6 text-sm text-oat rise rise-2">
            You can ask for leave here. Marking the staff register needs a permission you do not
            hold.
          </p>
        )}
        <LeavePanel canDecide={canDecide} />
      </div>
    </div>
  );
}
