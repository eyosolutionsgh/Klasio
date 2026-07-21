'use client';

import { useCallback, useEffect, useState } from 'react';
import Combobox from './Combobox';

interface AbsenteeSlot {
  id: string;
  className: string;
  period: string;
  subject: string | null;
  cover: { id: string; reliefTeacherId: string | null; reliefTeacher: string | null } | null;
}
interface SheetRow {
  id: string;
  className: string;
  period: string;
  subject: string | null;
  absent: string;
  relief: string | null;
  reason: string | null;
}

/**
 * Cover for an absent teacher, one date at a time. Pick who is away; each of their lessons that
 * day takes a relief teacher (clash-checked server-side, with the clash named) or is recorded
 * honestly as unstaffed. The day sheet is what goes on the staffroom wall.
 */
export default function SubstitutionsBoard({
  teachers,
  canManage,
}: {
  teachers: { id: string; name: string }[];
  canManage: boolean;
}) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [teacherId, setTeacherId] = useState('');
  const [slots, setSlots] = useState<AbsenteeSlot[]>([]);
  const [sheet, setSheet] = useState<SheetRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadSheet = useCallback(async () => {
    const res = await fetch(`/api/proxy/timetable/substitutions?date=${date}`);
    setSheet(res.ok ? await res.json() : []);
  }, [date]);

  const loadSlots = useCallback(async () => {
    if (!teacherId || !canManage) {
      setSlots([]);
      return;
    }
    setError(null);
    const res = await fetch(
      `/api/proxy/timetable/substitutions/absentee?teacherId=${teacherId}&date=${date}`,
    );
    if (res.ok) {
      const d = await res.json();
      setSlots(d.slots);
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? 'Could not load that day.');
      setSlots([]);
    }
  }, [teacherId, date, canManage]);

  useEffect(() => {
    loadSheet();
  }, [loadSheet]);
  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  async function setRelief(slot: AbsenteeSlot, reliefTeacherId: string) {
    setBusy(slot.id);
    setError(null);
    const res = await fetch('/api/proxy/timetable/substitutions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slotId: slot.id,
        date,
        reliefTeacherId: reliefTeacherId || undefined,
      }),
    });
    setBusy(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? 'Could not arrange that cover.');
      return;
    }
    loadSlots();
    loadSheet();
  }

  async function clearCover(slot: AbsenteeSlot) {
    if (!slot.cover) return;
    setBusy(slot.id);
    await fetch(`/api/proxy/timetable/substitutions/${slot.cover.id}`, { method: 'DELETE' });
    setBusy(null);
    loadSlots();
    loadSheet();
  }

  return (
    <div className="grid lg:grid-cols-[1.2fr_1fr] gap-6">
      {canManage && (
        <section className="card p-6 rise rise-2">
          <h2 className="font-display text-xl">Arrange cover</h2>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Combobox
              label="Who is away?"
              className="w-52"
              placeholder="Search staff…"
              options={teachers.map((t) => ({ value: t.id, label: t.name }))}
              value={teacherId}
              onChange={setTeacherId}
            />
            <label className="text-[12px] text-oat flex items-center gap-2">
              on
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="min-h-11 rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand"
              />
            </label>
          </div>

          <ul className="mt-4 space-y-2">
            {slots.map((s) => (
              <li key={s.id} className="rounded-lg border border-mist px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      {s.period} · {s.className}
                    </p>
                    <p className="text-[11px] text-oat">{s.subject ?? 'No subject set'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Combobox
                      label="Cover"
                      className="w-44"
                      clearLabel="Unstaffed"
                      placeholder="Relief teacher…"
                      options={teachers
                        .filter((t) => t.id !== teacherId)
                        .map((t) => ({ value: t.id, label: t.name }))}
                      value={s.cover?.reliefTeacherId ?? ''}
                      disabled={busy === s.id}
                      onChange={(v) => setRelief(s, v)}
                    />
                    {s.cover && (
                      <button
                        onClick={() => clearCover(s)}
                        disabled={busy === s.id}
                        className="text-[12px] text-clay hover:underline underline-offset-2"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
            {teacherId && slots.length === 0 && (
              <li className="text-sm text-oat py-3">Nothing timetabled for them that day.</li>
            )}
            {!teacherId && (
              <li className="text-sm text-oat py-3">
                Pick the absent teacher and the day, and their lessons appear here.
              </li>
            )}
          </ul>
          {error && <p className="text-sm text-danger mt-2">{error}</p>}
        </section>
      )}

      <section className="card p-6 rise rise-3">
        <h2 className="font-display text-xl">Cover sheet</h2>
        <p className="text-sm text-oat mt-1.5">
          {new Date(date).toLocaleDateString('en-GH', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
        <ul className="mt-4 space-y-2">
          {sheet.map((r) => (
            <li key={r.id} className="border-b border-mist/50 last:border-0 pb-2 last:pb-0">
              <p className="text-sm">
                <span className="font-medium">{r.period}</span> · {r.className}
                {r.subject && ` · ${r.subject}`}
              </p>
              <p className="text-[12px] text-oat">
                {r.absent} away —{' '}
                {r.relief ? (
                  <span className="text-leaf font-medium">{r.relief} covering</span>
                ) : (
                  <span className="text-clay font-medium">unstaffed</span>
                )}
              </p>
            </li>
          ))}
          {sheet.length === 0 && (
            <li className="text-sm text-oat">No cover arranged for this day.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
