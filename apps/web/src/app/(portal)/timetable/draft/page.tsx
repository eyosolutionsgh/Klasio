import Link from 'next/link';
import { api, getMe } from '@/lib/api';
import DraftBuilder from '@/components/DraftBuilder';

interface Options {
  classes: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
  teachers: { id: string; name: string }[];
}
interface Period {
  id: string;
  name: string;
  isBreak: boolean;
  startsAt: string;
}

export default async function TimetableDraftPage() {
  const me = await getMe();
  const perms = me.permissions ?? [];

  if (
    !me.entitlements.includes('timetable.core') ||
    !(me.user.role === 'OWNER' || perms.includes('timetable.manage'))
  ) {
    return (
      <div>
        <div className="rise rise-1">
          <Link href="/timetable" className="text-[13px] text-oat hover:text-brand transition">
            ← Back to the timetable
          </Link>
          <h1 className="font-display text-3xl mt-3">Draft a timetable</h1>
        </div>
        <p className="card p-6 mt-6 text-sm text-oat rise rise-2">
          Drafting needs the timetable package and permission to manage the timetable.
        </p>
      </div>
    );
  }

  const [options, periods] = await Promise.all([
    api<Options>('/timetable/options'),
    api<Period[]>('/timetable/periods'),
  ]);

  return (
    <div>
      <div className="rise rise-1">
        <Link href="/timetable" className="text-[13px] text-oat hover:text-brand transition">
          ← Back to the timetable
        </Link>
        <h1 className="font-display text-3xl mt-3">Draft a timetable</h1>
        <p className="text-sm text-oat mt-1.5">
          Say what each class must be taught and by whom; a clash-free week is proposed around where
          every teacher already is. You decide whether it goes on the timetable.
        </p>
      </div>

      <div className="mt-6">
        <DraftBuilder
          classes={options.classes}
          subjects={options.subjects}
          teachers={options.teachers}
          periods={periods}
        />
      </div>
    </div>
  );
}
