'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Combobox from './Combobox';

interface Template {
  kind: string;
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
};

const field =
  'rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

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
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([
      fetch('/api/proxy/fees/reminders/templates').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/proxy/fees/reminders/schedule').then((r) => (r.ok ? r.json() : null)),
    ]);
    const list: Template[] = Array.isArray(t) ? t : [];
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
    setBusy('schedule');
    setMessage(null);
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
    setBusy(null);
    if (res.ok) setSchedule(body);
    else setMessage(body.message ?? 'Could not save the schedule.');
  }

  async function saveTemplate(kind: string) {
    setBusy(kind);
    setMessage(null);
    const res = await fetch('/api/proxy/fees/reminders/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, body: drafts[kind] }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok) {
      setMessage('Saved.');
      load();
    } else setMessage(body.message ?? 'Could not save that wording.');
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
            disabled={busy === 'schedule'}
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
      </div>

      <div className="mt-5 pt-5 border-t border-mist/60 space-y-5">
        {templates.map((t) => (
          <div key={t.kind}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-medium">{TITLES[t.kind]?.title ?? t.kind}</h3>
              {!t.customised && (
                <span className="text-[10px] uppercase tracking-wider bg-parchment text-oat rounded-full px-2 py-0.5">
                  Default wording
                </span>
              )}
            </div>
            <p className="text-xs text-oat mt-1">{TITLES[t.kind]?.blurb}</p>
            <textarea
              value={drafts[t.kind] ?? ''}
              onChange={(e) => setDrafts({ ...drafts, [t.kind]: e.target.value })}
              rows={3}
              className={`${field} w-full mt-2`}
            />
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mt-2">
              <p className="text-xs text-oat">
                Placeholders: {t.placeholders.map((p) => `{${p}}`).join(' · ')} — anything else is
                sent as typed.
              </p>
              <button
                onClick={() => saveTemplate(t.kind)}
                disabled={busy === t.kind || (drafts[t.kind] ?? '') === t.body}
                className="rounded-lg bg-brand text-paper text-sm font-medium px-4 py-2 hover:bg-brand-deep transition disabled:opacity-50"
              >
                {busy === t.kind ? 'Saving…' : 'Save wording'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {message && <p className="text-sm mt-3">{message}</p>}
    </section>
  );
}
