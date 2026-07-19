'use client';

import { useCallback, useEffect, useState } from 'react';
import GuardianPay from '@/components/GuardianPay';
import { useRouter } from 'next/navigation';
import { fileKind, fileSize } from '@/lib/files';

/**
 * Human words for a parent.
 *
 * This list used to fall through to the raw enum, so a family granted a scholarship read
 * "DISCOUNT" on their own bill, a hardship waiver read "WAIVER", and a corrected charge read
 * "REVERSAL" — the most emotionally loaded rows on the page, shown as database values.
 */
const METHOD_LABEL: Record<string, string> = {
  MOMO: 'Mobile Money',
  CASH: 'Cash',
  BANK: 'Bank transfer',
  CARD: 'Card',
};

const LEDGER_LABEL = (type: string, method?: string | null) => {
  if (type === 'INVOICE') return 'School bill';
  if (type === 'PAYMENT') return `Payment${method ? ` · ${METHOD_LABEL[method] ?? method}` : ''}`;
  if (type === 'DISCOUNT') return 'Discount applied';
  if (type === 'WAIVER') return 'Amount waived by the school';
  if (type === 'REVERSAL') return 'Correction — earlier entry cancelled';
  return type;
};

interface Ward {
  id: string;
  name: string;
  admissionNo: string;
  className: string | null;
}
interface Me {
  guardian: { name: string };
  school: { name: string; phone: string | null; currency: string };
  wards: Ward[];
}
interface Overview {
  student: { name: string; admissionNo: string; className: string | null };
  feeBalance: number;
  ledger: {
    id: string;
    type: string;
    amount: number;
    method: string | null;
    reference: string;
    receiptNumber: string | null;
    createdAt: string;
  }[];
  attendance: Record<string, number>;
}
interface ReportRow {
  termId: string;
  term: string;
  year: string;
  overallTotal: number;
  classPosition: number | null;
  classSize: number | null;
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

/**
 * When an event happens, said the way a parent would say it. An all-day event has no useful
 * clock time, so showing "12:00 am" would be worse than showing nothing.
 */
const fmtWhen = (e: { startsAt: string; endsAt: string | null; allDay: boolean }) => {
  const day = fmtDate(e.startsAt);
  if (e.allDay) return day;
  const end = e.endsAt && new Date(e.endsAt).toDateString() === new Date(e.startsAt).toDateString();
  return `${day}, ${fmtTime(e.startsAt)}${end ? `–${fmtTime(e.endsAt!)}` : ''}`;
};

export default function FamilyPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [wardId, setWardId] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissalNote, setDismissalNote] = useState<string | null>(null);

  const money = (n: number) =>
    `${me?.school.currency ?? 'GHS'} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/family/guardian/me');
      if (res.status === 401) {
        router.push('/family/login');
        return;
      }
      const d: Me = await res.json();
      setMe(d);
      if (d.wards[0]) setWardId(d.wards[0].id);
      // Three independent feeds, all school-wide rather than per-ward — fetched together so a
      // slow connection pays one round trip instead of three.
      const [n, c, r] = await Promise.all([
        fetch('/api/family/guardian/notices'),
        fetch('/api/family/guardian/calendar'),
        fetch('/api/family/guardian/resources'),
      ]);
      if (n.ok) setNotices(await n.json());
      if (c.ok) setEvents(await c.json());
      if (r.ok) setResources(await r.json());
      setLoading(false);
    })();
  }, [router]);

  const loadWard = useCallback(async () => {
    if (!wardId) return;
    const [o, r] = await Promise.all([
      fetch(`/api/family/guardian/wards/${wardId}`).then((x) => (x.ok ? x.json() : null)),
      fetch(`/api/family/guardian/wards/${wardId}/reports`).then((x) => (x.ok ? x.json() : [])),
    ]);
    setOverview(o);
    setReports(Array.isArray(r) ? r : []);
  }, [wardId]);

  useEffect(() => {
    loadWard();
  }, [loadWard]);

  async function signOut() {
    await fetch('/api/guardian-session', { method: 'DELETE' });
    router.push('/family/login');
  }

  if (loading || !me) {
    return <main className="min-h-dvh flex items-center justify-center text-oat">Loading…</main>;
  }

  const att = overview?.attendance ?? {};
  const attTotal = Object.values(att).reduce((a, b) => a + b, 0);

  return (
    <main className="min-h-dvh">
      <header className="bg-forest-deep text-paper pt-[env(safe-area-inset-top)]">
        <div className="kente-stripe h-1.5" />
        <div className="max-w-3xl mx-auto px-5 py-5 flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-xl text-gold leading-none">{me.school.name}</p>
            <p className="text-[13px] text-paper/70 mt-1.5">Welcome, {me.guardian.name}</p>
          </div>
          <button
            onClick={signOut}
            className="shrink-0 -mr-2 -mt-1 min-h-11 px-2 text-[13px] text-paper/70 hover:text-gold transition underline underline-offset-2"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-5 py-6 space-y-6">
        {me.wards.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {me.wards.map((w) => (
              <button
                key={w.id}
                onClick={() => setWardId(w.id)}
                aria-pressed={wardId === w.id}
                // Two children can share a name, and on a phone the pill is all the parent sees —
                // so the class rides along to tell them apart.
                className={`min-h-11 text-sm rounded-2xl px-4 py-2 border text-left leading-tight transition ${
                  wardId === w.id
                    ? 'bg-forest text-paper border-forest'
                    : 'border-mist bg-white hover:border-forest'
                }`}
              >
                {w.name}
                {w.className && (
                  <span
                    className={`block text-[11px] ${wardId === w.id ? 'text-paper/70' : 'text-oat'}`}
                  >
                    {w.className}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {overview && (
          <>
            <section className="card p-6">
              <p className="font-display text-2xl">{overview.student.name}</p>
              <p className="text-sm text-oat mt-1 tabular">
                {overview.student.admissionNo}
                {overview.student.className && ` · ${overview.student.className}`}
              </p>
              <div className="mt-5 rounded-lg bg-parchment/70 p-5 text-center">
                <p className="text-[11px] uppercase tracking-widest text-oat">Fees outstanding</p>
                <p
                  className={`font-display text-3xl tabular mt-1 ${overview.feeBalance > 0 ? 'text-clay' : 'text-leaf'}`}
                >
                  {money(overview.feeBalance)}
                </p>
                {overview.feeBalance <= 0 && (
                  <p className="text-xs text-leaf mt-1">Fully paid — thank you.</p>
                )}
              </div>
            </section>

            <section className="card p-6">
              <h2 className="font-display text-xl">Attendance</h2>
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
              {attTotal > 0 && (
                <p className="text-xs text-oat mt-3">
                  {Math.round((((att.PRESENT ?? 0) + (att.LATE ?? 0)) / attTotal) * 100)}% across{' '}
                  {attTotal} marked days
                </p>
              )}
            </section>

            <section className="card p-6">
              <h2 className="font-display text-xl">Report cards</h2>
              {reports.length === 0 ? (
                <p className="text-sm text-oat mt-2">
                  No report cards have been released yet. They appear here once the school publishes
                  them.
                </p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {reports.map((r) => (
                    <li
                      key={r.termId}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-mist/50 last:border-0 pb-3 last:pb-0"
                    >
                      <div>
                        <p className="font-medium text-sm">
                          {r.term} · {r.year}
                        </p>
                        <p className="text-[11px] text-oat tabular">
                          Total {r.overallTotal.toFixed(1)}
                          {r.classPosition && ` · position ${r.classPosition} of ${r.classSize}`}
                        </p>
                      </div>
                      <a
                        href={`/api/family/guardian/wards/${wardId}/reports/${r.termId}/pdf`}
                        className="inline-flex items-center justify-center min-h-11 text-[13px] font-medium text-forest border border-forest/40 rounded-full px-4 hover:bg-forest-mist transition"
                      >
                        Download PDF
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card p-6">
              <h2 className="font-display text-xl">Bills &amp; payments</h2>
              <GuardianPay
                wardId={wardId}
                balance={overview.feeBalance}
                currency={me?.school.currency ?? 'GHS'}
                onDone={loadWard}
              />
              <ul className="mt-4 space-y-3">
                {overview.ledger.map((e) => (
                  <li
                    key={e.id}
                    className="flex justify-between gap-3 text-sm border-b border-mist/50 last:border-0 pb-2.5 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{LEDGER_LABEL(e.type, e.method)}</p>
                      <p className="text-[11px] text-oat tabular">
                        {fmtDate(e.createdAt)}
                        {e.receiptNumber && ` · receipt ${e.receiptNumber}`}
                      </p>
                      {e.receiptNumber && (
                        <a
                          href={`/api/family/guardian/wards/${wardId}/receipts/${e.reference}/pdf`}
                          className="inline-flex items-center min-h-11 text-[12px] font-medium text-forest underline underline-offset-2"
                        >
                          Download receipt ↓
                        </a>
                      )}
                    </div>
                    <p
                      className={`tabular font-medium shrink-0 ${e.type === 'INVOICE' ? 'text-ink' : 'text-leaf'}`}
                    >
                      {e.type === 'INVOICE' ? '' : '−'}
                      {money(e.amount)}
                    </p>
                  </li>
                ))}
                {overview.ledger.length === 0 && (
                  <li className="text-sm text-oat">Nothing billed yet.</li>
                )}
              </ul>
            </section>
          </>
        )}

        {overview && (
          <section className="card p-6">
            <h2 className="font-display text-xl">Change today&apos;s pickup</h2>
            <p className="text-sm text-oat mt-1.5">
              Someone else collecting, or an early finish? Tell the school here. They will confirm —
              nothing changes until they do.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const res = await fetch(`/api/family/guardian/wards/${wardId}/dismissal-requests`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    forDate: String(f.get('forDate')),
                    details: String(f.get('details')),
                  }),
                });
                setDismissalNote(
                  res.ok
                    ? 'Sent to the school. You will get a text once they confirm.'
                    : 'Could not send that just now.',
                );
                if (res.ok) (e.target as HTMLFormElement).reset();
              }}
              className="mt-4 space-y-3"
            >
              <input
                name="forDate"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-base outline-none focus:border-forest focus:ring-2 focus:ring-forest/15"
              />
              <textarea
                name="details"
                required
                minLength={6}
                rows={3}
                placeholder="My brother Kofi Mensah will collect Ama today at 2pm."
                className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-base outline-none focus:border-forest focus:ring-2 focus:ring-forest/15"
              />
              <button className="w-full min-h-11 rounded-lg bg-forest text-paper font-medium hover:bg-forest-deep transition">
                Send to the school
              </button>
            </form>
            {dismissalNote && <p className="text-sm text-leaf mt-3">{dismissalNote}</p>}
          </section>
        )}

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
          The API already returns only what this family may see, already excludes anything that
          has finished, and already sorts soonest-first. Filtering again here would hide events
          twice — so this renders the list exactly as it arrives.
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
          <h2 className="font-display text-xl">Things to download</h2>
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
                  href={`/api/family/guardian/resources/${r.id}/file`}
                  className="inline-flex items-center min-h-11 text-[13px] font-medium text-forest underline underline-offset-2"
                >
                  Download ↓
                </a>
              </li>
            ))}
            {resources.length === 0 && (
              <li className="text-sm text-oat">
                The school has not shared any files yet. Homework sheets and past questions will
                appear here.
              </li>
            )}
          </ul>
        </section>

        {/* On a phone this is the parent's fastest route to a human — make it dial. */}
        <p className="text-xs text-oat text-center pb-[max(1rem,env(safe-area-inset-bottom))]">
          Questions?{' '}
          {me.school.phone ? (
            <>
              Call the school on{' '}
              <a
                href={`tel:${me.school.phone.replace(/[^\d+]/g, '')}`}
                className="inline-flex items-center min-h-11 font-medium text-forest underline underline-offset-2"
              >
                {me.school.phone}
              </a>
            </>
          ) : (
            'Call the school.'
          )}
        </p>
      </div>
    </main>
  );
}
