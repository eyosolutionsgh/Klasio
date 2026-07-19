import { api, getMe } from '@/lib/api';
import CalendarFilters from '@/components/CalendarFilters';
import AddEvent from '@/components/AddEvent';
import EventActions from '@/components/EventActions';

interface CalendarEvent {
  id: string;
  title: string;
  details: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  audience: 'ALL' | 'STAFF' | 'GUARDIANS' | 'STUDENTS';
  levelId: string | null;
  levelName: string | null;
}
interface Structure {
  levels: { id: string; name: string }[];
}

const AUDIENCES = [
  { key: 'ALL', label: 'Everyone' },
  { key: 'STAFF', label: 'Staff only' },
  { key: 'GUARDIANS', label: 'Guardians' },
  { key: 'STUDENTS', label: 'Students' },
];

const audienceLabel = (a: string) => AUDIENCES.find((x) => x.key === a)?.label ?? a;

/** Six months back and twelve forward — enough to plan a year without an infinite picker. */
function monthOptions(): { value: string; label: string }[] {
  const now = new Date();
  const out: { value: string; label: string }[] = [];
  for (let i = -6; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-GH', { month: 'long', year: 'numeric' }),
    });
  }
  return out;
}

const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; audience?: string; levelId?: string }>;
}) {
  const { month, audience, levelId } = await searchParams;
  const months = monthOptions();
  const current = months.some((m) => m.value === month)
    ? month!
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

  const [year, mon] = current.split('-').map(Number);
  const from = `${current}-01`;
  // Day 0 of the next month is the last day of this one.
  const to = new Date(year, mon, 0).toISOString().slice(0, 10);

  const qs = new URLSearchParams({ from, to });
  if (audience) qs.set('audience', audience);

  const [events, structure, me] = await Promise.all([
    api<CalendarEvent[]>(`/calendar?${qs}`),
    api<Structure>('/school/structure'),
    getMe(),
  ]);

  // The API filters by audience; the level filter is applied here because the month's events are
  // already in hand and a second round trip would buy nothing.
  const shown = levelId ? events.filter((e) => e.levelId === levelId) : events;
  // Writing to the calendar is `calendar.manage` on the API. Asking what this person may do beats
  // guessing from their role title, which a school is free to redefine.
  const canEdit = me.permissions?.includes('calendar.manage') ?? false;

  const days = new Map<string, CalendarEvent[]>();
  for (const e of shown) {
    const key = dayKey(e.startsAt);
    days.set(key, [...(days.get(key) ?? []), e]);
  }

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">School calendar</h1>
        <p className="text-sm text-oat mt-1.5">
          Term dates, examinations, PTA meetings and holidays. Each event shows only to the audience
          it was written for.
        </p>
      </div>

      <div className="mt-6 rise rise-2">
        <CalendarFilters
          month={current}
          audience={audience}
          levelId={levelId}
          months={months}
          audiences={AUDIENCES}
          levels={structure.levels}
        />
      </div>

      <div className="grid lg:grid-cols-[1fr_1.4fr] gap-6 mt-6">
        {canEdit && <AddEvent levels={structure.levels} audiences={AUDIENCES} />}

        <section className={`space-y-4 ${canEdit ? '' : 'lg:col-span-2'}`}>
          {[...days.entries()].map(([key, list], i) => (
            <article key={key} className={`card p-5 rise rise-${Math.min(4, i + 1)}`}>
              <p className="text-[11px] uppercase tracking-widest text-oat">
                {new Date(key).toLocaleDateString('en-GH', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </p>
              <ul className="mt-3 space-y-3">
                {list.map((e) => (
                  <li key={e.id} className="border-l-2 border-brand/40 pl-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="font-display text-lg leading-snug">{e.title}</h3>
                      {canEdit && (
                        <EventActions event={e} levels={structure.levels} audiences={AUDIENCES} />
                      )}
                    </div>
                    <p className="text-[11px] text-oat mt-0.5">
                      {e.allDay
                        ? 'All day'
                        : new Date(e.startsAt).toLocaleTimeString('en-GH', {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                      {' · '}
                      {audienceLabel(e.audience)}
                      {e.levelName && ` · ${e.levelName}`}
                      {e.location && ` · ${e.location}`}
                    </p>
                    {e.details && (
                      <p className="text-sm text-ink/80 mt-1.5 leading-relaxed">{e.details}</p>
                    )}
                  </li>
                ))}
              </ul>
            </article>
          ))}
          {shown.length === 0 && (
            <p className="text-sm text-oat p-4">Nothing on the calendar for this month.</p>
          )}
        </section>
      </div>
    </div>
  );
}
