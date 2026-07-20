'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Combobox from './Combobox';
import { Button, useAsyncAction } from './Button';
import { SaveIcon } from './icons';

export interface Template {
  kind: string;
  label?: string;
  body: string;
  customised: boolean;
  placeholders: string[];
}
interface Schedule {
  enabled: boolean;
  dayOfWeek: number | null;
  hour: number;
  lastRunAt: string | null;
}

const DAYS = [
  { value: '', label: 'Every weekday' },
  { value: '1', label: 'Mondays' },
  { value: '2', label: 'Tuesdays' },
  { value: '3', label: 'Wednesdays' },
  { value: '4', label: 'Thursdays' },
  { value: '5', label: 'Fridays' },
  { value: '6', label: 'Saturdays' },
  { value: '0', label: 'Sundays' },
];

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, '0')}:00`,
}));

const TITLES: Record<string, { title: string; blurb: string }> = {
  FEE_REMINDER_GENTLE: {
    title: 'Gentle reminder',
    blurb: 'Sent to families owing under GHS 500.',
  },
  FEE_REMINDER_FIRM: {
    title: 'Firm reminder',
    blurb: 'Sent to families owing GHS 500 or more.',
  },
  ABSENCE_ALERT: {
    title: 'Absence alert',
    blurb: 'Texted the same morning to the family of a child marked absent.',
  },
  RESULTS_READY: {
    title: 'Results notification',
    blurb: 'Texted to every family when terminal reports are published.',
  },
  PICKUP_RELEASED: {
    title: 'Pickup confirmation',
    blurb: 'Texted the moment a child is released at the gate.',
  },
};

const field =
  'rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

/**
 * One reminder's wording and its own save button.
 *
 * A component per template rather than a `busy === kind` string in the parent: the button state
 * belongs to the row that owns it, and `useAsyncAction` is a hook, so it cannot be called inside
 * the map.
 */
export function TemplateEditor({
  template,
  draft,
  onDraftChange,
  onSaved,
}: {
  template: Template;
  draft: string;
  onDraftChange: (next: string) => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const save = useAsyncAction(async () => {
    setError(null);
    const res = await fetch('/api/proxy/fees/reminders/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: template.kind, body: draft }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.message ?? 'Could not save that wording.');
      throw new Error('rejected');
    }
    onSaved();
  });

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">
          {TITLES[template.kind]?.title ?? template.label ?? template.kind}
        </h3>
        {!template.customised && (
          <span className="text-[10px] uppercase tracking-wider bg-parchment text-oat rounded-full px-2 py-0.5">
            Default wording
          </span>
        )}
      </div>
      <p className="text-xs text-oat mt-1">{TITLES[template.kind]?.blurb}</p>
      <textarea
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        rows={3}
        className={`${field} w-full mt-2`}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mt-2">
        <p className="text-xs text-oat">
          Placeholders: {template.placeholders.map((p) => `{${p}}`).join(' · ')} — anything else is
          sent as typed.
        </p>
        <Button
          onClick={save.run}
          state={save.state}
          icon={<SaveIcon />}
          size="sm"
          disabled={draft === template.body}
        >
          Save wording
        </Button>
      </div>
      {/* The server's reason, which the button cannot carry — it can only say "Couldn't save". */}
      {error && <p className="text-xs text-danger mt-1.5">{error}</p>}
    </div>
  );
}

/**
 * The wording of fee reminders and when they go out automatically.
 *
 * The schedule is only a stored intent: it is read by a background worker that needs Redis, and
 * the API exposes no way to ask whether that worker is running. Rather than let the toggle imply
 * a guarantee, the copy says plainly what it does and does not promise, and points at the manual
 * send that always works.
 */
export default function ReminderSettings() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([
      fetch('/api/proxy/fees/reminders/templates').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/proxy/fees/reminders/schedule').then((r) => (r.ok ? r.json() : null)),
    ]);
    // Only fee wording here; the other automatic messages are edited on the Messaging page.
    const list: Template[] = (Array.isArray(t) ? t : []).filter((x: Template) =>
      x.kind.startsWith('FEE_'),
    );
    setTemplates(list);
    setDrafts(Object.fromEntries(list.map((x) => [x.kind, x.body])));
    setSchedule(s);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveSchedule(next: Partial<Schedule>) {
    if (!schedule) return;
    const merged = { ...schedule, ...next };
    setSchedule(merged);
    setSavingSchedule(true);
    setScheduleError(null);
    const res = await fetch('/api/proxy/fees/reminders/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: merged.enabled,
        dayOfWeek: merged.dayOfWeek ?? undefined,
        hour: merged.hour,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingSchedule(false);
    if (res.ok) setSchedule(body);
    else setScheduleError(body.message ?? 'Could not save the schedule.');
  }

  if (!schedule) return null;

  return (
    <section className="card p-6 rise rise-3 max-w-2xl">
      <h2 className="font-display text-xl">Fee reminders</h2>
      <p className="text-sm text-oat mt-1.5">
        What a reminder says, and when it goes out. A family hears the gentle or the firm wording
        depending on how much they owe, and never more than one message per term per day.
      </p>

      <div className="mt-5 pt-5 border-t border-mist/60">
        <label className="flex items-start gap-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={schedule.enabled}
            disabled={savingSchedule}
            onChange={(e) => saveSchedule({ enabled: e.target.checked })}
            className="w-4 h-4 mt-0.5"
          />
          <span>
            <span className="font-medium">Send reminders automatically</span>
            <span className="block text-[13px] text-oat">
              Everyone owing on the current term is texted on the schedule below.
            </span>
          </span>
        </label>

        {schedule.enabled && (
          <div className="flex flex-wrap items-end gap-3 mt-4">
            <Combobox
              label="Day"
              className="w-full sm:w-52"
              allowClear={false}
              placeholder="Search days…"
              options={DAYS}
              value={schedule.dayOfWeek === null ? '' : String(schedule.dayOfWeek)}
              onChange={(v) => saveSchedule({ dayOfWeek: v === '' ? null : Number(v) })}
            />
            <Combobox
              label="Time"
              className="w-full sm:w-36"
              allowClear={false}
              placeholder="Search times…"
              options={HOURS}
              value={String(schedule.hour)}
              onChange={(v) => saveSchedule({ hour: Number(v) })}
            />
          </div>
        )}

        {/* Honesty about what the toggle actually buys. The setting is stored either way; the
            sending is done by a background worker, and this app cannot see whether it is up. */}
        <p className="text-xs text-oat mt-4 rounded-lg bg-parchment/60 px-3.5 py-3">
          Scheduled sending is carried out by the background worker, which the installation must
          have running (it needs Redis). This page can save the schedule but cannot confirm the
          worker is up — if reminders never leave, ask whoever runs your server.{' '}
          <Link href="/fees" className="text-brand hover:underline underline-offset-2">
            Sending reminders by hand
          </Link>{' '}
          from the Fees page always works.
          {schedule.lastRunAt && (
            <span className="block mt-1.5 tabular">
              Last automatic run:{' '}
              {new Date(schedule.lastRunAt).toLocaleString('en-GH', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
          {schedule.enabled && !schedule.lastRunAt && (
            <span className="block mt-1.5">It has not run yet.</span>
          )}
        </p>

        {/* The schedule saves itself off a toggle, so there is no button to carry a failure. */}
        {scheduleError && <p className="text-sm text-danger mt-3">{scheduleError}</p>}
      </div>

      <div className="mt-5 pt-5 border-t border-mist/60 space-y-5">
        {templates.map((t) => (
          <TemplateEditor
            key={t.kind}
            template={t}
            draft={drafts[t.kind] ?? ''}
            onDraftChange={(next) => setDrafts({ ...drafts, [t.kind]: next })}
            onSaved={load}
          />
        ))}
      </div>
    </section>
  );
}
