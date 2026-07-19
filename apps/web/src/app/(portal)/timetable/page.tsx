'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Combobox from '@/components/Combobox';
import SchoolDay, { type Period } from '@/components/SchoolDay';
import { Button, useAsyncAction } from '@/components/Button';
import { ChoiceCards } from '@/components/ChoiceCards';
import { SaveIcon, TrashIcon } from '@/components/icons';

interface Slot {
  id: string;
  periodId: string;
  weekday: number;
  classId: string;
  className: string;
  subjectId: string | null;
  subject: string | null;
  teacherId: string | null;
  teacher: string | null;
  room: string | null;
}
interface Grid {
  scope: { kind: 'CLASS' | 'TEACHER'; id: string; name: string };
  periods: Period[];
  slots: Slot[];
}
interface Options {
  classes: { id: string; name: string; level: string }[];
  subjects: { id: string; name: string; code: string }[];
  teachers: { id: string; name: string; role: string }[];
  weekdays: { value: number; name: string }[];
}

type View = 'CLASS' | 'TEACHER';

export default function TimetablePage() {
  const [options, setOptions] = useState<Options | null>(null);
  const [view, setView] = useState<View>('CLASS');
  const [classId, setClassId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [grid, setGrid] = useState<Grid | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  /** The cell being timetabled: null when the editor is closed. */
  const [editing, setEditing] = useState<{ period: Period; weekday: number; slot?: Slot } | null>(
    null,
  );
  const [draftSubject, setDraftSubject] = useState('');
  const [draftTeacher, setDraftTeacher] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/proxy/timetable/options').then((r) => r.json()),
      fetch('/api/proxy/me').then((r) => r.json()),
    ]).then(([o, me]: [Options, { user: { id: string }; permissions?: string[] }]) => {
      setOptions(o);
      // What this person may do, not what they are called: a school can put building the
      // timetable on any staff role it likes, and role names would miss that.
      setCanEdit((me.permissions ?? []).includes('timetable.manage'));
      if (o.classes[0]) setClassId(o.classes[0].id);
      // Default the teacher view to whoever is looking, when they are on the list.
      const self = o.teachers.find((t) => t.id === me.user.id);
      setTeacherId(self?.id ?? o.teachers[0]?.id ?? '');
    });
  }, []);

  const scopeId = view === 'CLASS' ? classId : teacherId;

  const load = useCallback(async () => {
    if (!scopeId) return;
    const path = view === 'CLASS' ? 'class' : 'teacher';
    const res = await fetch(`/api/proxy/timetable/${path}/${scopeId}`);
    if (!res.ok) return;
    setGrid(await res.json());
    setEditing(null);
  }, [view, scopeId]);

  useEffect(() => {
    load();
  }, [load]);

  /** period id → weekday → slot, so a cell is a lookup rather than a scan of the whole week. */
  const byCell = useMemo(() => {
    const map = new Map<string, Slot>();
    for (const s of grid?.slots ?? []) map.set(`${s.periodId}:${s.weekday}`, s);
    return map;
  }, [grid]);

  function openCell(period: Period, weekday: number) {
    if (!canEdit || view !== 'CLASS' || period.isBreak) return;
    const slot = byCell.get(`${period.id}:${weekday}`);
    setEditing({ period, weekday, slot });
    setDraftSubject(slot?.subjectId ?? '');
    setDraftTeacher(slot?.teacherId ?? '');
    setError('');
  }

  const saveAction = useAsyncAction(async () => {
    if (!editing) return;
    setError('');
    // PATCH an existing lesson, POST a new one — the clash check runs either way, and only the
    // edit path can tell the API that the row in the way is the row being changed.
    const res = editing.slot
      ? await fetch(`/api/proxy/timetable/slots/${editing.slot.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subjectId: draftSubject || null,
            teacherId: draftTeacher || null,
          }),
        })
      : await fetch('/api/proxy/timetable/slots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classId,
            periodId: editing.period.id,
            weekday: editing.weekday,
            subjectId: draftSubject || undefined,
            teacherId: draftTeacher || undefined,
          }),
        });
    if (res.ok) {
      await load();
      return;
    }
    const d = await res.json().catch(() => ({}));
    // A clash comes back as one sentence naming the other lesson; show it verbatim.
    setError(
      Array.isArray(d.message)
        ? d.message.join('. ')
        : (d.message ?? 'Could not save that lesson.'),
    );
    throw new Error('rejected');
  });

  const clearAction = useAsyncAction(async () => {
    if (!editing?.slot) return;
    const res = await fetch(`/api/proxy/timetable/slots/${editing.slot.id}`, { method: 'DELETE' });
    // Reload either way, as before — but the button must not tick for a delete that was refused.
    await load();
    if (!res.ok) throw new Error('rejected');
  });

  const weekdays = options?.weekdays ?? [];

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Timetable</h1>
        <p className="text-sm text-oat mt-1.5">
          The week for one class, or for one member of staff. A teacher already busy in another
          class is refused with the clash named.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3 rise rise-2">
        {/* No icons: nothing in the set means "a class", and one icon on two cards reads as odd. */}
        <ChoiceCards
          legend="View"
          name="timetable-view"
          className="w-full sm:w-72"
          value={view}
          onChange={setView}
          options={[
            { value: 'CLASS', label: 'By class' },
            { value: 'TEACHER', label: 'By teacher' },
          ]}
        />

        {view === 'CLASS' ? (
          <Combobox
            label="Class"
            className="w-full sm:w-60"
            allowClear={false}
            placeholder="Search classes…"
            options={(options?.classes ?? []).map((c) => ({
              value: c.id,
              label: c.name,
              hint: c.level,
            }))}
            value={classId}
            onChange={setClassId}
          />
        ) : (
          <Combobox
            label="Teacher"
            className="w-full sm:w-60"
            allowClear={false}
            placeholder="Search staff…"
            options={(options?.teachers ?? []).map((t) => ({ value: t.id, label: t.name }))}
            value={teacherId}
            onChange={setTeacherId}
          />
        )}

        {canEdit && (
          <div className="ml-auto flex items-center gap-3">
            {view === 'CLASS' && (
              <p className="text-[13px] text-oat">Select a cell to timetable a lesson.</p>
            )}
            <SchoolDay onChanged={load} />
          </div>
        )}
      </div>

      {editing && (
        <div className="card mt-5 p-4 rise">
          <p className="text-sm font-medium">
            {editing.period.name} · {weekdays.find((w) => w.value === editing.weekday)?.name}
            <span className="text-oat font-normal">
              {' '}
              · {editing.period.startsAt}–{editing.period.endsAt}
            </span>
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Combobox
              label="Subject"
              className="w-full sm:w-56"
              clearLabel="No subject"
              placeholder="Search subjects…"
              options={(options?.subjects ?? []).map((s) => ({ value: s.id, label: s.name }))}
              value={draftSubject}
              onChange={setDraftSubject}
            />
            <Combobox
              label="Teacher"
              className="w-full sm:w-56"
              clearLabel="Unstaffed"
              placeholder="Search staff…"
              options={(options?.teachers ?? []).map((t) => ({ value: t.id, label: t.name }))}
              value={draftTeacher}
              onChange={setDraftTeacher}
            />
            <Button onClick={saveAction.run} state={saveAction.state} icon={<SaveIcon />}>
              Save lesson
            </Button>
            {editing.slot && (
              /* Emptying one cell is a small, re-doable edit, so it keeps its quiet treatment
                 rather than becoming a solid danger button beside the primary save. */
              <Button
                variant="ghost"
                onClick={clearAction.run}
                state={clearAction.state}
                icon={<TrashIcon />}
                className="text-danger"
                pendingLabel="Clearing…"
                doneLabel="Cleared!"
                failedLabel="Couldn't clear"
              >
                Clear
              </Button>
            )}
            <Button variant="ghost" size="sm" type="button" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
          {error && (
            <p
              role="alert"
              className="mt-3 text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2"
            >
              {error}
            </p>
          )}
        </div>
      )}

      <div className="card mt-5 overflow-x-auto rise rise-3">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <th className="px-5 py-3 font-medium w-40">Period</th>
              {weekdays.map((d) => (
                <th key={d.value} className="px-3 py-3 font-medium">
                  {d.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(grid?.periods ?? []).map((p) => (
              <tr key={p.id} className="border-b border-mist/60 last:border-0 align-top">
                <td className="px-5 py-2.5">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-[11px] text-oat tabular">
                    {p.startsAt}–{p.endsAt}
                  </p>
                </td>
                {p.isBreak ? (
                  // A break runs across the whole week — drawing five empty boxes would invite
                  // someone to try to teach in one.
                  <td
                    colSpan={weekdays.length}
                    className="px-3 py-2.5 text-[13px] text-oat bg-parchment/40 text-center"
                  >
                    Break
                  </td>
                ) : (
                  weekdays.map((d) => {
                    const slot = byCell.get(`${p.id}:${d.value}`);
                    const editable = canEdit && view === 'CLASS';
                    return (
                      <td key={d.value} className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => openCell(p, d.value)}
                          disabled={!editable}
                          aria-label={`${p.name}, ${d.name}${slot?.subject ? `: ${slot.subject}` : ' — free'}`}
                          className={`w-full text-left rounded-lg px-3 py-2 min-h-14 transition ${
                            slot
                              ? 'bg-brand-mist/60 border border-brand/15'
                              : 'border border-dashed border-mist'
                          } ${editable ? 'hover:border-brand cursor-pointer' : 'cursor-default'}`}
                        >
                          {slot ? (
                            <>
                              <span className="block font-medium leading-tight">
                                {slot.subject ?? 'Unassigned'}
                              </span>
                              <span className="block text-[11px] text-oat mt-0.5">
                                {view === 'CLASS' ? (slot.teacher ?? 'Unstaffed') : slot.className}
                                {slot.room ? ` · ${slot.room}` : ''}
                              </span>
                            </>
                          ) : (
                            <span className="block text-[12px] text-oat/70">Free</span>
                          )}
                        </button>
                      </td>
                    );
                  })
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {grid && grid.periods.length === 0 && (
          <div className="px-5 py-8">
            <p className="text-sm text-oat">
              No periods yet. Divide the day into periods — first lesson, break, lunch and the rest
              — before timetabling any lessons.
            </p>
            {canEdit ? (
              <div className="mt-4">
                <SchoolDay variant="primary" onChanged={load} />
              </div>
            ) : (
              <p className="mt-2 text-sm text-oat">
                Ask whoever builds the timetable at your school to set the periods out.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
