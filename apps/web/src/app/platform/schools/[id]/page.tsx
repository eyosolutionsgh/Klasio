'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import PlatformSchoolActions from '@/components/PlatformSchoolActions';
import { day, isSignedOut, platformCall } from '@/lib/platform-client';

/**
 * One school, in full.
 *
 * The list answers "who is on the platform"; this answers "what is going on with this one" —
 * what they are paying, who runs it, everything EYO has said to them, and everything EYO has
 * done to them. The last two are the point: a suspension with no visible history is a decision
 * nobody can review later.
 */

interface Detail {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  region: string | null;
  website: string | null;
  tier: string;
  currency: string;
  suspended: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  createdAt: string;
  amount: number | null;
  studentCount: number;
  staffCount: number;
  subscription: {
    tier: string;
    status: string;
    periodStart: string;
    periodEnd: string;
  } | null;
  owners: { id: string; name: string; email: string; active: boolean }[];
  notices: {
    id: string;
    subject: string;
    body: string;
    level: 'INFO' | 'WARNING';
    readAt: string | null;
    createdAt: string;
    sentBy: { name: string };
  }[];
  actions: {
    id: string;
    action: string;
    detail: Record<string, unknown> | null;
    createdAt: string;
    admin: { name: string };
  }[];
}

/** Plain English for the audit trail — `school.suspend` is a log line, not a sentence. */
const ACTION_LABEL: Record<string, string> = {
  'school.suspend': 'Suspended the school',
  'school.restore': 'Restored access',
  'school.contact': 'Sent a notice',
  'school.reset_owner_password': 'Reset the owner password',
  'invitation.issue': 'Issued an invitation',
  'invitation.revoke': 'Withdrew an invitation',
};

export default function SchoolDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [school, setSchool] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSchool(await platformCall<Detail>(`schools/${id}`));
      setError(null);
    } catch (e) {
      if (!isSignedOut(e)) setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="min-h-dvh">
      <header className="bg-forest-deep text-paper">
        <div className="accent-rule h-[3px]" />
        <div className="max-w-5xl mx-auto px-6 py-5">
          <Link
            href="/platform/schools"
            className="text-[13px] text-paper/60 hover:text-paper transition"
          >
            ← All schools
          </Link>
          <h1 className="font-display text-2xl mt-1">{school?.name ?? 'School'}</h1>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {loading && <p className="text-sm text-oat">Loading…</p>}
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
        {flash && (
          <p role="status" className="text-[13px] text-leaf mb-4">
            {flash}
          </p>
        )}

        {school && (
          <>
            {school.suspended && (
              <div role="alert" className="card p-5 border-l-4 border-l-danger">
                <p className="text-sm font-medium text-danger">
                  Suspended{school.suspendedAt ? ` on ${day(school.suspendedAt)}` : ''}.
                </p>
                {school.suspendedReason && (
                  <p className="text-[12.5px] text-oat mt-1">
                    Reason given: {school.suspendedReason}
                  </p>
                )}
                <p className="text-[12.5px] text-oat mt-1">
                  Nobody at this school can sign in. Nothing has been deleted or downgraded —
                  restoring puts them back exactly as they were.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
              {[
                { label: 'Package', value: school.tier },
                { label: 'Students', value: String(school.studentCount) },
                { label: 'Staff', value: String(school.staffCount) },
                {
                  label: 'Paying',
                  value:
                    school.amount === null
                      ? '—'
                      : `${school.currency} ${school.amount.toLocaleString('en-GH')}`,
                },
              ].map((s) => (
                <div key={s.label} className="card card-accent p-5">
                  <p className="text-[11px] uppercase tracking-widest text-oat">{s.label}</p>
                  <p className="font-display text-2xl mt-2">{s.value}</p>
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-5 mt-6">
              <section className="card p-6">
                <h2 className="font-display text-xl">Details</h2>
                <dl className="mt-3 text-sm space-y-2">
                  {[
                    ['Email', school.email],
                    ['Phone', school.phone],
                    ['Address', school.address],
                    ['Region', school.region],
                    ['Website', school.website],
                    ['On Klasio since', day(school.createdAt)],
                    [
                      'Billing period',
                      school.subscription
                        ? `${day(school.subscription.periodStart)} → ${day(school.subscription.periodEnd)} · ${school.subscription.status}`
                        : 'No subscription on file',
                    ],
                  ].map(([label, value]) => (
                    <div key={label as string} className="flex gap-3">
                      <dt className="text-oat w-32 shrink-0">{label}</dt>
                      <dd className="text-ink">{value || <span className="text-oat">—</span>}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="card p-6">
                <h2 className="font-display text-xl">Who runs it</h2>
                {school.owners.length === 0 && (
                  <p className="text-sm text-oat mt-3">No owner account on this school.</p>
                )}
                <ul className="mt-3 space-y-2 text-sm">
                  {school.owners.map((o) => (
                    <li key={o.id}>
                      <span className="font-medium">{o.name}</span>
                      {!o.active && <span className="ml-2 text-[12.5px] text-oat">(inactive)</span>}
                      <span className="block text-[12.5px] text-oat">{o.email}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-5 pt-5 border-t border-mist">
                  <PlatformSchoolActions
                    school={school}
                    compact
                    onDone={(note) => {
                      setFlash(note);
                      setError(null);
                      load();
                    }}
                    onError={setError}
                  />
                </div>
              </section>
            </div>

            <section className="card p-6 mt-6">
              <h2 className="font-display text-xl">What Klasio has said</h2>
              <p className="text-[12.5px] text-oat mt-1">
                Notices shown inside this school&rsquo;s portal. &ldquo;Seen&rdquo; means someone
                there dismissed it.
              </p>
              <ul className="mt-4 space-y-3">
                {school.notices.map((n) => (
                  <li key={n.id} className="border-b border-mist/60 last:border-0 pb-3 last:pb-0">
                    <div className="flex items-baseline justify-between gap-3 flex-wrap">
                      <p
                        className={`text-sm font-medium ${n.level === 'WARNING' ? 'text-danger' : ''}`}
                      >
                        {n.subject}
                      </p>
                      <p className="text-[12.5px] text-oat">
                        {day(n.createdAt)} · {n.sentBy.name} ·{' '}
                        {n.readAt ? `seen ${day(n.readAt)}` : 'not yet seen'}
                      </p>
                    </div>
                    <p className="text-[13px] text-ink/80 mt-1 whitespace-pre-wrap">{n.body}</p>
                  </li>
                ))}
                {school.notices.length === 0 && (
                  <li className="text-sm text-oat">Nothing has been sent to this school.</li>
                )}
              </ul>
            </section>

            <section className="card p-6 mt-6">
              <h2 className="font-display text-xl">What Klasio has done</h2>
              <p className="text-[12.5px] text-oat mt-1">
                The vendor&rsquo;s own record, kept apart from the school&rsquo;s audit log — they
                can neither read nor change this.
              </p>
              <ul className="mt-4 space-y-2">
                {school.actions.map((a) => (
                  <li key={a.id} className="text-sm flex gap-3 flex-wrap">
                    <span className="text-oat tabular w-28 shrink-0">{day(a.createdAt)}</span>
                    <span>{ACTION_LABEL[a.action] ?? a.action}</span>
                    <span className="text-oat">— {a.admin.name}</span>
                    {typeof a.detail?.reason === 'string' && (
                      <span className="text-oat basis-full pl-31">
                        &ldquo;{a.detail.reason}&rdquo;
                      </span>
                    )}
                  </li>
                ))}
                {school.actions.length === 0 && (
                  <li className="text-sm text-oat">Nothing recorded yet.</li>
                )}
              </ul>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
