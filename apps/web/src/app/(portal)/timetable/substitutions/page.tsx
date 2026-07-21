import Link from 'next/link';
import { api, getMe } from '@/lib/api';
import SubstitutionsBoard from '@/components/SubstitutionsBoard';

interface Options {
  teachers: { id: string; name: string }[];
}

export default async function SubstitutionsPage() {
  const me = await getMe();

  if (!me.entitlements.includes('timetable.core')) {
    return (
      <div>
        <div className="rise rise-1">
          <Link href="/timetable" className="text-[13px] text-oat hover:text-brand transition">
            ← Back to the timetable
          </Link>
          <h1 className="font-display text-3xl mt-3">Substitutions</h1>
        </div>
        <p className="card p-6 mt-6 text-sm text-oat rise rise-2">
          Substitutions arrive with the timetable, which is part of a higher package.
        </p>
      </div>
    );
  }

  const options = await api<Options>('/timetable/options');
  const perms = me.permissions ?? [];
  const canManage = me.user.role === 'OWNER' || perms.includes('timetable.manage');

  return (
    <div>
      <div className="rise rise-1">
        <Link href="/timetable" className="text-[13px] text-oat hover:text-brand transition">
          ← Back to the timetable
        </Link>
        <h1 className="font-display text-3xl mt-3">Substitutions</h1>
        <p className="text-sm text-oat mt-1.5">
          Cover for a teacher who is away — clash-checked like any other placement, and honest when
          a lesson simply goes unstaffed.
        </p>
      </div>

      <div className="mt-6">
        <SubstitutionsBoard teachers={options.teachers} canManage={canManage} />
      </div>
    </div>
  );
}
