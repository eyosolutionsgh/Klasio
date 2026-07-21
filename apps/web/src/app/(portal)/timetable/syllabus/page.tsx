import Link from 'next/link';
import { api, getMe } from '@/lib/api';
import SyllabusBoard from '@/components/SyllabusBoard';

interface Structure {
  levels: { id: string; name: string }[];
  classes: { id: string; name: string; levelId: string }[];
  subjects: { id: string; name: string }[];
}

export default async function SyllabusPage() {
  const me = await getMe();

  if (!me.entitlements.includes('timetable.core')) {
    return (
      <div>
        <div className="rise rise-1">
          <Link href="/timetable" className="text-[13px] text-oat hover:text-brand transition">
            ← Back to the timetable
          </Link>
          <h1 className="font-display text-3xl mt-3">Syllabus coverage</h1>
        </div>
        <p className="card p-6 mt-6 text-sm text-oat rise rise-2">
          Syllabus tracking arrives with the timetable, which is part of a higher package. Ask
          whoever manages your subscription about an upgrade.
        </p>
      </div>
    );
  }

  const structure = await api<Structure>('/school/structure');
  const perms = me.permissions ?? [];
  const isOwner = me.user.role === 'OWNER';

  return (
    <div>
      <div className="rise rise-1">
        <Link href="/timetable" className="text-[13px] text-oat hover:text-brand transition">
          ← Back to the timetable
        </Link>
        <h1 className="font-display text-3xl mt-3">Syllabus coverage</h1>
        <p className="text-sm text-oat mt-1.5">
          The scheme of work as a tick-list — what each class has actually been taught.
        </p>
      </div>

      <div className="mt-6">
        <SyllabusBoard
          subjects={structure.subjects}
          levels={structure.levels}
          classes={structure.classes}
          canConfigure={isOwner || perms.includes('assessment.configure')}
          canTick={isOwner || perms.includes('marks.enter')}
        />
      </div>
    </div>
  );
}
