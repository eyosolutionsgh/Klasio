'use client';

import { useState } from 'react';
import Combobox from './Combobox';
import { Button, useAsyncAction } from './Button';
import { PlusIcon, SaveIcon } from './icons';

interface Period {
  id: string;
  name: string;
  isBreak: boolean;
  startsAt: string;
}
interface Placement {
  weekday: number;
  periodId: string;
  subjectId: string;
  teacherId: string | null;
  subject: string;
  teacher: string | null;
}
interface Unplaced {
  subject: string;
  teacher: string | null;
  missing: number;
}
interface DemandRow {
  subjectId: string;
  teacherId: string;
  perWeek: number;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/**
 * "A timetable drafted for you." The draft is a proposal: generate, look at the grid, then
 * apply — each placement goes through the same clash rules as a hand-made one, so nothing is
 * ever overwritten silently.
 */
export default function DraftBuilder({
  classes,
  subjects,
  teachers,
  periods,
}: {
  classes: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
  teachers: { id: string; name: string }[];
  periods: Period[];
}) {
  const [classId, setClassId] = useState('');
  const [demands, setDemands] = useState<DemandRow[]>([
    { subjectId: '', teacherId: '', perWeek: 4 },
  ]);
  const [placed, setPlaced] = useState<Placement[] | null>(null);
  const [unplaced, setUnplaced] = useState<Unplaced[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  const ready = classId && demands.some((d) => d.subjectId && d.perWeek > 0);

  const generate = useAsyncAction(async () => {
    setError(null);
    setApplied(null);
    const res = await fetch('/api/proxy/timetable/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classId,
        demands: demands
          .filter((d) => d.subjectId && d.perWeek > 0)
          .map((d) => ({
            subjectId: d.subjectId,
            teacherId: d.teacherId || undefined,
            perWeek: d.perWeek,
          })),
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(Array.isArray(d.message) ? d.message.join('. ') : (d.message ?? 'Could not draft.'));
      throw new Error('rejected');
    }
    setPlaced(d.placed);
    setUnplaced(d.unplaced);
  });

  const apply = useAsyncAction(async () => {
    if (!placed) return;
    setError(null);
    const res = await fetch('/api/proxy/timetable/draft/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classId,
        slots: placed.map((p) => ({
          periodId: p.periodId,
          weekday: p.weekday,
          subjectId: p.subjectId,
          teacherId: p.teacherId ?? undefined,
        })),
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.message ?? 'Could not apply the draft.');
      throw new Error('rejected');
    }
    setApplied(
      `${d.created} lesson${d.created === 1 ? '' : 's'} placed.` +
        (d.refused.length > 0
          ? ` ${d.refused.length} refused — the timetable changed since the draft; regenerate to fill the gaps.`
          : ''),
    );
    setPlaced(null);
  });

  const cell = (weekday: number, periodId: string) =>
    placed?.find((p) => p.weekday === weekday && p.periodId === periodId);

  return (
    <div className="space-y-6">
      <section className="card p-6 rise rise-2">
        <Combobox
          label="Class"
          className="w-56"
          allowClear={false}
          placeholder="Draft for which class…"
          options={classes.map((c) => ({ value: c.id, label: c.name }))}
          value={classId}
          onChange={setClassId}
        />

        <p className="text-[11px] uppercase tracking-wider text-oat mt-5">What must be taught</p>
        <div className="mt-2 space-y-2">
          {demands.map((d, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Combobox
                label="Subject"
                className="w-44"
                placeholder="Subject…"
                options={subjects.map((s) => ({ value: s.id, label: s.name }))}
                value={d.subjectId}
                onChange={(v) =>
                  setDemands(demands.map((x, j) => (j === i ? { ...x, subjectId: v } : x)))
                }
              />
              <Combobox
                label="Teacher"
                className="w-44"
                clearLabel="Unstaffed"
                placeholder="Teacher…"
                options={teachers.map((t) => ({ value: t.id, label: t.name }))}
                value={d.teacherId}
                onChange={(v) =>
                  setDemands(demands.map((x, j) => (j === i ? { ...x, teacherId: v } : x)))
                }
              />
              <label className="text-[12px] text-oat flex items-center gap-2">
                lessons/week
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={d.perWeek}
                  onChange={(e) =>
                    setDemands(
                      demands.map((x, j) =>
                        j === i ? { ...x, perWeek: parseInt(e.target.value, 10) || 1 } : x,
                      ),
                    )
                  }
                  className="w-16 min-h-11 rounded-lg border border-mist bg-white px-2 py-2 text-sm tabular outline-none focus:border-brand"
                />
              </label>
              <button
                onClick={() => setDemands(demands.filter((_, j) => j !== i))}
                className="text-[12px] text-clay hover:underline underline-offset-2"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-3">
          <Button
            variant="ghost"
            size="sm"
            icon={<PlusIcon />}
            onClick={() => setDemands([...demands, { subjectId: '', teacherId: '', perWeek: 4 }])}
          >
            Another subject
          </Button>
          <Button
            onClick={generate.run}
            state={generate.state}
            disabled={!ready}
            pendingLabel="Drafting…"
            doneLabel="Drafted!"
            failedLabel="Couldn't draft"
          >
            Draft the week
          </Button>
        </div>
        {error && <p className="text-sm text-danger mt-3">{error}</p>}
        {applied && (
          <p className="text-sm text-leaf bg-leaf/10 border border-leaf/20 rounded-lg px-3 py-2 mt-3">
            {applied}
          </p>
        )}
      </section>

      {placed && (
        <section className="card p-6 rise rise-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl">The proposal</h2>
            <Button
              onClick={apply.run}
              state={apply.state}
              icon={<SaveIcon />}
              pendingLabel="Applying…"
              doneLabel="Applied!"
              failedLabel="Couldn't apply"
            >
              Apply to the timetable
            </Button>
          </div>
          {unplaced.length > 0 && (
            <p className="text-sm text-clay mt-2">
              Could not fit:{' '}
              {unplaced
                .map((u) => `${u.missing} × ${u.subject}${u.teacher ? ` (${u.teacher})` : ''}`)
                .join(', ')}
              . Free some periods or reduce the demand.
            </p>
          )}
          <div className="overflow-x-auto mt-4 -mx-6 px-6">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr>
                  <th className="text-left text-[10px] uppercase tracking-wider text-oat p-2">
                    Period
                  </th>
                  {DAYS.map((d) => (
                    <th
                      key={d}
                      className="text-left text-[10px] uppercase tracking-wider text-oat p-2"
                    >
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id} className="border-t border-mist/60">
                    <td className="p-2 font-medium whitespace-nowrap">
                      {p.name}
                      <span className="block text-[10px] text-oat tabular">{p.startsAt}</span>
                    </td>
                    {p.isBreak ? (
                      <td colSpan={5} className="p-2 text-center text-oat bg-parchment/50">
                        Break
                      </td>
                    ) : (
                      [1, 2, 3, 4, 5].map((w) => {
                        const c = cell(w, p.id);
                        return (
                          <td key={w} className="p-2 align-top">
                            {c ? (
                              <span className="block rounded-md bg-brand-mist/60 px-2 py-1">
                                <span className="font-medium">{c.subject}</span>
                                {c.teacher && (
                                  <span className="block text-[10px] text-oat">{c.teacher}</span>
                                )}
                              </span>
                            ) : (
                              <span className="text-oat/40">—</span>
                            )}
                          </td>
                        );
                      })
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
