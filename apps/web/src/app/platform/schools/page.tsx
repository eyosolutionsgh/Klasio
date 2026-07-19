'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PlatformSchoolActions from '@/components/PlatformSchoolActions';
import { day, isSignedOut, platformCall } from '@/lib/platform-client';

/**
 * The vendor console.
 *
 * Everything EYO can do to a school from inside the product: see who is on the platform, let a
 * new one in, close one's doors, open them again, and say something to one school in particular.
 *
 * Client-rendered like the guardian and student portals rather than server-rendered like the
 * staff portal, because every action here changes the list it is looking at and the page is one
 * screen rather than a section of a shell.
 */

interface School {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  region: string | null;
  tier: string;
  suspended: boolean;
  suspendedReason: string | null;
  studentCount: number;
  staffCount: number;
  createdAt: string;
  subscription: { status: string; periodEnd: string } | null;
}

interface Invitation {
  id: string;
  schoolName: string;
  email: string;
  tier: string;
  expiresAt: string;
  state: 'OPEN' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  school: { id: string; name: string } | null;
}

const TIERS = ['BASIC', 'MEDIUM', 'ADVANCED'];

const STATE_TONE: Record<Invitation['state'], string> = {
  OPEN: 'bg-brand-mist text-brand',
  ACCEPTED: 'bg-leaf/10 text-leaf',
  REVOKED: 'bg-parchment text-oat',
  EXPIRED: 'bg-parchment text-oat',
};

export default function PlatformSchoolsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'schools' | 'invitations'>('schools');
  const [schools, setSchools] = useState<School[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // New invitation, and the token it produced. The token is shown once and never again.
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteTier, setInviteTier] = useState('BASIC');
  const [issued, setIssued] = useState<{ link: string; email: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, i] = await Promise.all([
        platformCall<School[]>(`schools${q ? `?q=${encodeURIComponent(q)}` : ''}`),
        platformCall<Invitation[]>('invitations'),
      ]);
      setSchools(s);
      setInvitations(i);
      setError(null);
    } catch (e) {
      if (!isSignedOut(e)) setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, note: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setFlash(note);
      await load();
    } catch (e) {
      if (!isSignedOut(e)) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await platformCall<{ token: string; email: string }>('invitations', {
        method: 'POST',
        body: JSON.stringify({ schoolName: inviteName, email: inviteEmail, tier: inviteTier }),
      });
      setIssued({
        link: `${window.location.origin}/register?token=${encodeURIComponent(created.token)}`,
        email: created.email,
      });
      setInviteName('');
      setInviteEmail('');
      await load();
    } catch (err) {
      if (!isSignedOut(err)) setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function revoke(inv: Invitation) {
    if (!window.confirm(`Withdraw the invitation for ${inv.schoolName}? The link stops working.`))
      return;
    act(
      () => platformCall(`invitations/${inv.id}/revoke`, { method: 'POST' }),
      `Invitation for ${inv.schoolName} withdrawn.`,
    );
  }

  async function signOut() {
    await fetch('/api/platform-session', { method: 'DELETE' });
    router.push('/platform/login');
  }

  const btn =
    'min-h-11 rounded-lg text-sm font-medium px-4 transition disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <main className="min-h-dvh">
      <header className="bg-forest-deep text-paper">
        <div className="accent-rule h-[3px]" />
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-paper/50">Klasio Platform</p>
            <h1 className="font-display text-2xl">Schools</h1>
          </div>
          <button
            onClick={signOut}
            className="min-h-11 text-sm text-paper/70 hover:text-paper transition"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex gap-2 border-b border-mist">
          {(['schools', 'invitations'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`min-h-11 px-4 text-sm capitalize border-b-2 -mb-px transition ${
                tab === t
                  ? 'border-brand text-ink font-medium'
                  : 'border-transparent text-oat hover:text-ink'
              }`}
            >
              {t}
              {t === 'invitations' && invitations.some((i) => i.state === 'OPEN') && (
                <span className="ml-2 text-[11px] rounded-full px-1.5 py-0.5 bg-brand-mist text-brand">
                  {invitations.filter((i) => i.state === 'OPEN').length}
                </span>
              )}
            </button>
          ))}
        </div>

        {flash && (
          <p role="status" className="mt-5 text-[13px] text-leaf">
            {flash}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-5 text-[13px] text-danger">
            {error}
          </p>
        )}
        {loading && <p className="mt-6 text-sm text-oat">Loading…</p>}

        {!loading && tab === 'schools' && (
          <>
            <div className="mt-6 flex items-center gap-3">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name or email"
                className="min-h-11 w-full max-w-sm rounded-lg border border-mist bg-white px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
              <span className="text-[13px] text-oat whitespace-nowrap">
                {schools.length} school{schools.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="card mt-4 overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
                    <th className="px-5 py-2.5 font-medium">School</th>
                    <th className="px-3 py-2.5 font-medium">Package</th>
                    <th className="px-3 py-2.5 font-medium text-right">Students</th>
                    <th className="px-3 py-2.5 font-medium text-right">Staff</th>
                    <th className="px-3 py-2.5 font-medium">Since</th>
                    <th className="px-5 py-2.5 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {schools.map((s) => (
                    <tr key={s.id} className="border-b border-mist/60 last:border-0 align-top">
                      <td className="px-5 py-3">
                        <Link
                          href={`/platform/schools/${s.id}`}
                          className="font-medium hover:text-brand transition"
                        >
                          {s.name}
                        </Link>
                        {s.suspended && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 bg-danger/10 text-danger">
                            Suspended
                          </span>
                        )}
                        <span className="block text-[12.5px] text-oat">
                          {s.email ?? 'no email'}
                          {s.region ? ` · ${s.region}` : ''}
                        </span>
                        {s.suspended && s.suspendedReason && (
                          <span className="block text-[12.5px] text-danger mt-0.5">
                            {s.suspendedReason}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">{s.tier}</td>
                      <td className="px-3 py-3 text-right tabular">{s.studentCount}</td>
                      <td className="px-3 py-3 text-right tabular">{s.staffCount}</td>
                      <td className="px-3 py-3 text-oat text-[12.5px] whitespace-nowrap">
                        {day(s.createdAt)}
                      </td>
                      <td className="px-5 py-3">
                        <PlatformSchoolActions
                          school={s}
                          compact
                          onDone={(note) => {
                            setFlash(note);
                            setError(null);
                            load();
                          }}
                          onError={setError}
                        />
                      </td>
                    </tr>
                  ))}
                  {schools.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-oat">
                        No schools yet. Invite one from the Invitations tab.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!loading && tab === 'invitations' && (
          <>
            <form onSubmit={invite} className="card p-6 mt-6">
              <h2 className="font-display text-xl">Invite a school</h2>
              <p className="text-[12.5px] text-oat mt-1 leading-relaxed">
                Nobody can put a school on Klasio without one of these. The proprietor sets their
                own password and fills in their own details; this only decides that they may.
              </p>
              <div className="mt-4 grid sm:grid-cols-3 gap-3">
                <input
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  required
                  minLength={2}
                  placeholder="School name"
                  className="min-h-11 rounded-lg border border-mist bg-white px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                />
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  type="email"
                  placeholder="Proprietor's email"
                  className="min-h-11 rounded-lg border border-mist bg-white px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                />
                <select
                  value={inviteTier}
                  onChange={(e) => setInviteTier(e.target.value)}
                  className="min-h-11 rounded-lg border border-mist bg-white px-3 text-sm outline-none focus:border-brand"
                >
                  {TIERS.map((t) => (
                    <option key={t} value={t}>
                      Start on {t}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={busy}
                className={`${btn} bg-brand text-paper hover:bg-brand-deep mt-3`}
              >
                {busy ? 'Creating…' : 'Create invitation'}
              </button>
            </form>

            {issued && (
              <div role="status" className="card p-5 mt-4 border-l-4 border-l-leaf">
                <p className="text-sm font-medium">Send this link to {issued.email}.</p>
                <p className="text-[12.5px] text-oat mt-1">
                  Shown once — it is stored only as a hash, so it cannot be read back. If it is
                  lost, withdraw this invitation and issue another.
                </p>
                <code className="block mt-3 text-[12.5px] break-all bg-parchment/70 rounded-lg px-3 py-2">
                  {issued.link}
                </code>
                <button
                  onClick={() => navigator.clipboard?.writeText(issued.link)}
                  className={`${btn} border border-mist bg-white hover:border-ink mt-3`}
                >
                  Copy link
                </button>
              </div>
            )}

            <div className="card mt-5 overflow-x-auto">
              <table className="w-full text-sm min-w-[680px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
                    <th className="px-5 py-2.5 font-medium">School</th>
                    <th className="px-3 py-2.5 font-medium">Invited</th>
                    <th className="px-3 py-2.5 font-medium">Package</th>
                    <th className="px-3 py-2.5 font-medium">Expires</th>
                    <th className="px-5 py-2.5 font-medium">State</th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((i) => (
                    <tr key={i.id} className="border-b border-mist/60 last:border-0">
                      <td className="px-5 py-3 font-medium">{i.schoolName}</td>
                      <td className="px-3 py-3 text-oat text-[12.5px]">{i.email}</td>
                      <td className="px-3 py-3">{i.tier}</td>
                      <td className="px-3 py-3 text-oat text-[12.5px] whitespace-nowrap">
                        {day(i.expiresAt)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 ${STATE_TONE[i.state]}`}
                        >
                          {i.state}
                        </span>
                        {i.state === 'OPEN' && (
                          <button
                            onClick={() => revoke(i)}
                            disabled={busy}
                            className="ml-3 text-[12.5px] text-danger hover:underline"
                          >
                            Withdraw
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {invitations.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center text-oat">
                        No invitations yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
