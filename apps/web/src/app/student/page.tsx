'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PortalBrandHeader from '@/components/PortalBrandHeader';
import { fileKind, fileSize } from '@/lib/files';

interface Me {
  student: { name: string; admissionNo: string; className: string | null };
  school: { name: string; phone: string | null; currency: string };
  feeBalance: number;
  attendance: Record<string, number>;
  reports: {
    termId: string;
    term: string;
    year: string;
    /** Null when the school is holding this report over unpaid fees. */
    overallTotal: number | null;
    classPosition: number | null;
    held?: boolean;
    heldReason?: string | null;
    classSize: number | null;
  }[];
}
interface Notice {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
}
interface CalendarEvent {
  id: string;
  title: string;
  details: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  levelName: string | null;
}
interface Resource {
  id: string;
  title: string;
  description: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  subjectName: string | null;
  levelName: string | null;
  className: string | null;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });

const fmtTime = (d: string) =>
  new Date(d).toLocaleTimeString('en-GH', { hour: 'numeric', minute: '2-digit' });

/** An all-day event has no useful clock time — "12:00 am" would read as a mistake. */
const fmtWhen = (e: { startsAt: string; endsAt: string | null; allDay: boolean }) => {
  const day = fmtDate(e.startsAt);
  if (e.allDay) return day;
  const end = e.endsAt && new Date(e.endsAt).toDateString() === new Date(e.startsAt).toDateString();
  return `${day}, ${fmtTime(e.startsAt)}${end ? `–${fmtTime(e.endsAt!)}` : ''}`;
};

export default function StudentPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/student/student/me');
      if (res.status === 401) {
        router.push('/student/login');
        return;
      }
      setMe(await res.json());
      // Fetched together so a slow connection pays one round trip instead of three.
      const [n, c, r] = await Promise.all([
        fetch('/api/student/student/notices'),
        fetch('/api/student/student/calendar'),
        fetch('/api/student/student/resources'),
      ]);
      if (n.ok) setNotices(await n.json());
      if (c.ok) setEvents(await c.json());
      if (r.ok) setResources(await r.json());
    })();
  }, [router]);

  async function signOut() {
    await fetch('/api/student-session', { method: 'DELETE' });
    router.push('/student/login');
  }

  if (!me) {
    return <main className="min-h-dvh flex items-center justify-center text-oat">Loading…</main>;
  }

  const att = me.attendance;
  const total = Object.values(att).reduce((a, b) => a + b, 0);
  const money = (n: number) =>
    `${me.school.currency} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2 })}`;

  return (
    <main className="min-h-dvh">
      <PortalBrandHeader
        schoolName={me.school.name}
        subtitle={
          <>
            {me.student.name} · {me.student.admissionNo}
            {me.student.className && ` · ${me.student.className}`}
          </>
        }
        action={
          <button
            onClick={signOut}
            className="shrink-0 -mr-2 -mt-1 min-h-11 px-2 text-[13px] text-paper/70 hover:text-gold-bright transition underline underline-offset-2"
          >
            Sign out
          </button>
        }
      />

      <div className="max-w-3xl mx-auto px-5 py-6 space-y-6">
        <section className="card p-6">
          <h2 className="font-display text-xl">My attendance</h2>
          <div className="mt-4 grid grid-cols-4 gap-3 text-center">
            {(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as const).map((k) => (
              <div key={k} className="rounded-lg bg-parchment/60 py-3">
                <p className="font-display text-xl tabular">{att[k] ?? 0}</p>
                <p className="text-[10px] uppercase tracking-wider text-oat mt-1">
                  {k.toLowerCase()}
                </p>
              </div>
            ))}
          </div>
          {total > 0 && (
            <p className="text-xs text-oat mt-3">
              {Math.round((((att.PRESENT ?? 0) + (att.LATE ?? 0)) / total) * 100)}% across {total}{' '}
              marked days
            </p>
          )}
        </section>

        <section className="card p-6">
          <h2 className="font-display text-xl">My tests</h2>
          <p className="text-sm text-oat mt-1.5">
            Computer-based tests your teachers have set.{' '}
            <a
              href="/student/exams"
              className="text-forest font-medium underline underline-offset-2"
            >
              Open my tests →
            </a>
          </p>
        </section>

        <section className="card p-6">
          <h2 className="font-display text-xl">My results</h2>
          {me.reports.length === 0 ? (
            <p className="text-sm text-oat mt-2">
              No terminal reports have been released yet. They appear here once the school publishes
              them.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {me.reports.map((r) => (
                <li
                  key={r.termId}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-mist/50 last:border-0 pb-3 last:pb-0"
                >
                  <div>
                    <p className="font-medium text-sm">
                      {r.term} · {r.year}
                    </p>
                    {/* Same rule as the family portal: shown and explained, never silently gone. */}
                    {r.held ? (
                      <p className="text-[11px] text-clay max-w-prose">
                        {r.heldReason ?? 'Held until the outstanding fees are settled.'}
                      </p>
                    ) : (
                      <p className="text-[11px] text-oat tabular">
                        Total {(r.overallTotal ?? 0).toFixed(1)}
                        {r.classPosition && ` · position ${r.classPosition} of ${r.classSize}`}
                      </p>
                    )}
                  </div>
                  {r.held ? (
                    <span className="inline-flex items-center justify-center min-h-11 text-[13px] font-medium text-clay border border-clay/40 rounded-full px-4">
                      Held
                    </span>
                  ) : (
                    <a
                      href={`/api/student/student/reports/${r.termId}/pdf`}
                      className="inline-flex items-center justify-center min-h-11 text-[13px] font-medium text-forest border border-forest/40 rounded-full px-4 hover:bg-forest-mist transition"
                    >
                      Download PDF
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-6">
          <h2 className="font-display text-xl">My fees</h2>
          <p
            className={`font-display text-3xl tabular mt-2 ${me.feeBalance > 0 ? 'text-clay' : 'text-leaf'}`}
          >
            {money(me.feeBalance)}
          </p>
          <p className="text-xs text-oat mt-1">
            {me.feeBalance > 0 ? 'Outstanding on your account.' : 'Fully paid — thank you.'}
          </p>
        </section>

        <section className="card p-6">
          <h2 className="font-display text-xl">School notices</h2>
          <ul className="mt-4 space-y-4">
            {notices.map((n) => (
              <li key={n.id} className="border-b border-mist/50 last:border-0 pb-3 last:pb-0">
                <p className="font-medium text-sm">{n.title}</p>
                <p className="text-[11px] text-oat">{fmtDate(n.publishedAt)}</p>
                <p className="text-sm mt-1.5">{n.body}</p>
              </li>
            ))}
            {notices.length === 0 && <li className="text-sm text-oat">No notices yet.</li>}
          </ul>
        </section>

        {/*
          The API already limits this to what this pupil may see, drops anything that has already
          finished, and sorts soonest-first. Re-filtering here would hide events twice.
        */}
        <section className="card p-6">
          <h2 className="font-display text-xl">What&apos;s coming up</h2>
          <ul className="mt-4 space-y-4">
            {events.map((e) => (
              <li key={e.id} className="border-b border-mist/50 last:border-0 pb-3 last:pb-0">
                <p className="font-medium text-sm">{e.title}</p>
                <p className="text-[11px] text-oat">
                  {fmtWhen(e)}
                  {e.location && ` · ${e.location}`}
                  {e.levelName && ` · ${e.levelName}`}
                </p>
                {e.details && <p className="text-sm mt-1.5">{e.details}</p>}
              </li>
            ))}
            {events.length === 0 && (
              <li className="text-sm text-oat">
                Nothing on the calendar yet. Term dates and school events will show up here.
              </li>
            )}
          </ul>
        </section>

        <section className="card p-6">
          <h2 className="font-display text-xl">My class files</h2>
          <ul className="mt-4 space-y-4">
            {resources.map((r) => (
              <li key={r.id} className="border-b border-mist/50 last:border-0 pb-3 last:pb-0">
                <p className="font-medium text-sm">{r.title}</p>
                <p className="text-[11px] text-oat">
                  {fileKind(r.mimeType)} · {fileSize(r.sizeBytes)}
                  {[r.subjectName, r.className ?? r.levelName]
                    .filter(Boolean)
                    .map((x) => ` · ${x}`)
                    .join('')}
                </p>
                {r.description && <p className="text-sm mt-1.5">{r.description}</p>}
                <a
                  href={`/api/student/student/resources/${r.id}/file`}
                  className="inline-flex items-center min-h-11 text-[13px] font-medium text-forest underline underline-offset-2"
                >
                  Download ↓
                </a>
              </li>
            ))}
            {resources.length === 0 && (
              <li className="text-sm text-oat">
                Your teachers have not shared any files yet. Notes and past questions will appear
                here.
              </li>
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}
