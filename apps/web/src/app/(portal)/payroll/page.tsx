'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, useAsyncAction } from '@/components/Button';
import { SaveIcon } from '@/components/icons';

interface ProfileRow {
  userId: string;
  name: string;
  roleName: string | null;
  profile: {
    basicSalary: number;
    allowances: number;
    deductions: number;
    payoutMethod: string;
    payoutAccount: string | null;
    payoutName: string | null;
  } | null;
}
interface RunSummary {
  id: string;
  period: string;
  status: string;
  staff: number;
  totalNet: number;
  totalPaye: number;
  totalSsnit: number;
}
interface RunLine {
  userId: string;
  staffName: string;
  roleName: string | null;
  gross: number;
  ssnitEmployee: number;
  paye: number;
  otherDeductions: number;
  net: number;
}
interface RunDetail {
  id: string;
  period: string;
  status: string;
  lines: RunLine[];
}

const money = (n: number) =>
  `GHS ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const field =
  'min-h-11 rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand';

/**
 * Payroll: salaries in, SSNIT and PAYE computed, payslips and payout files out. A run is a
 * DRAFT until approved; approval freezes it — later salary changes never rewrite a paid month.
 */
export default function PayrollPage() {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, r] = await Promise.all([
      fetch('/api/proxy/payroll/profiles'),
      fetch('/api/proxy/payroll/runs'),
    ]);
    if (p.status === 403 || p.status === 404) {
      setDenied(true);
      return;
    }
    if (p.ok) setProfiles(await p.json());
    if (r.ok) setRuns(await r.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openRun = useCallback(async (id: string) => {
    const res = await fetch(`/api/proxy/payroll/runs/${id}`);
    if (res.ok) setRun(await res.json());
  }, []);

  const saveProfile = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    const f = new FormData(form);
    setError(null);
    const res = await fetch('/api/proxy/payroll/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: String(f.get('userId')),
        basicSalary: Number(f.get('basicSalary')),
        allowances: Number(f.get('allowances') || 0),
        deductions: Number(f.get('deductions') || 0),
        payoutMethod: String(f.get('payoutMethod')),
        payoutAccount: String(f.get('payoutAccount') ?? '') || undefined,
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? 'Could not save.');
      throw new Error('rejected');
    }
    setEditing(null);
    load();
  });

  const createRun = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    const f = new FormData(e.currentTarget);
    setError(null);
    const res = await fetch('/api/proxy/payroll/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period: String(f.get('period')) }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.message ?? 'Could not compute that month.');
      throw new Error('rejected');
    }
    setRun(d);
    load();
  });

  /**
   * Approving freezes a month's figures, so it asks first — but in the page, not through
   * `window.confirm`.
   *
   * The native dialog is suppressed in embedded and automated browsers, and a suppressed
   * `confirm()` returns false. Approving could therefore never succeed there: no dialog appeared,
   * the handler took the cancelled branch, and the button reported "Couldn't approve" for a
   * request it had never sent. It threw to reach that state, which also put an uncaught error in
   * the console — so a user declining their own prompt was recorded as a failure twice over.
   *
   * The stop below is the one the graduation flow already uses: named, counted, and dismissable
   * without anything claiming to have failed.
   */
  const [confirmingApproval, setConfirmingApproval] = useState(false);
  /** Summed from the run's own lines — the same figures the confirmation is about to freeze. */
  const runNet = (run?.lines ?? []).reduce((sum, l) => sum + l.net, 0);

  const approve = useAsyncAction(async () => {
    if (!run) return;
    const res = await fetch(`/api/proxy/payroll/runs/${run.id}/approve`, { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Said out loud rather than swallowed: "Couldn't approve" alone leaves the bursar guessing
      // at a month they cannot pay.
      setError(d.message ?? 'Could not approve that month.');
      throw new Error('rejected');
    }
    setConfirmingApproval(false);
    openRun(run.id);
    load();
  });

  if (denied) {
    return (
      <div>
        <div className="rise rise-1">
          <h1 className="font-display text-3xl">Payroll</h1>
        </div>
        <p className="card p-6 mt-6 text-sm text-oat rise rise-2">
          Payroll needs the payroll package and its permission — the heaviest permission in the
          building, because it shows every colleague&apos;s salary.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Payroll</h1>
        <p className="text-sm text-oat mt-1.5">
          SSNIT (5.5% / 13%) and GRA PAYE computed from the salaries you set. Approve a month to
          freeze it, then print payslips and download the bank or MoMo payout file.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-6 mt-6">
        <section className="card p-6 rise rise-2">
          <h2 className="font-display text-xl">Salaries</h2>
          <ul className="mt-4 space-y-2">
            {profiles.map((p) => (
              <li key={p.userId} className="border-b border-mist/50 last:border-0 pb-2 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-[11px] text-oat">
                      {p.roleName ?? '—'}
                      {p.profile
                        ? ` · basic ${money(p.profile.basicSalary)} · ${p.profile.payoutMethod === 'MOMO' ? 'MoMo' : 'bank'}`
                        : ' · no salary set'}
                    </p>
                  </div>
                  <button
                    onClick={() => setEditing(editing === p.userId ? null : p.userId)}
                    className="text-[12px] text-brand hover:underline underline-offset-2 shrink-0"
                  >
                    {editing === p.userId ? 'Cancel' : p.profile ? 'Edit' : 'Set salary'}
                  </button>
                </div>
                {editing === p.userId && (
                  <form onSubmit={saveProfile.run} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="userId" value={p.userId} />
                    <label className="text-[11px] text-oat">
                      Basic
                      <input
                        name="basicSalary"
                        type="number"
                        min={0}
                        step="0.01"
                        required
                        defaultValue={p.profile?.basicSalary}
                        className={`${field} block w-28 tabular`}
                      />
                    </label>
                    <label className="text-[11px] text-oat">
                      Allowances
                      <input
                        name="allowances"
                        type="number"
                        min={0}
                        step="0.01"
                        defaultValue={p.profile?.allowances ?? 0}
                        className={`${field} block w-28 tabular`}
                      />
                    </label>
                    <label className="text-[11px] text-oat">
                      Deductions
                      <input
                        name="deductions"
                        type="number"
                        min={0}
                        step="0.01"
                        defaultValue={p.profile?.deductions ?? 0}
                        className={`${field} block w-28 tabular`}
                      />
                    </label>
                    <label className="text-[11px] text-oat">
                      Paid by
                      <select
                        name="payoutMethod"
                        defaultValue={p.profile?.payoutMethod ?? 'BANK'}
                        className={`${field} block`}
                      >
                        <option value="BANK">Bank</option>
                        <option value="MOMO">MoMo</option>
                      </select>
                    </label>
                    <label className="text-[11px] text-oat">
                      Account / wallet
                      <input
                        name="payoutAccount"
                        defaultValue={p.profile?.payoutAccount ?? ''}
                        className={`${field} block w-40 tabular`}
                      />
                    </label>
                    <Button type="submit" state={saveProfile.state} icon={<SaveIcon />} size="sm">
                      Save
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {error && <p className="text-sm text-danger mt-3">{error}</p>}
        </section>

        <div className="space-y-6">
          <section className="card p-6 rise rise-3">
            <h2 className="font-display text-xl">Pay runs</h2>
            <form onSubmit={createRun.run} className="mt-3 flex gap-2">
              <input
                name="period"
                type="month"
                required
                defaultValue={new Date().toISOString().slice(0, 7)}
                className={field}
              />
              <Button
                type="submit"
                state={createRun.state}
                pendingLabel="Computing…"
                doneLabel="Computed!"
                failedLabel="Couldn't compute"
              >
                Compute month
              </Button>
            </form>
            <ul className="mt-4 space-y-2">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => openRun(r.id)}
                    className={`w-full text-left rounded-lg border px-3 py-2 transition ${
                      run?.id === r.id
                        ? 'border-brand bg-brand-mist/40'
                        : 'border-mist hover:border-brand'
                    }`}
                  >
                    <span className="flex justify-between text-sm">
                      <span className="font-medium tabular">{r.period}</span>
                      <span
                        className={`text-[11px] uppercase tracking-wider ${
                          r.status === 'APPROVED' ? 'text-leaf' : 'text-gold'
                        }`}
                      >
                        {r.status.toLowerCase()}
                      </span>
                    </span>
                    <span className="block text-[11px] text-oat tabular">
                      {r.staff} staff · net {money(r.totalNet)} · PAYE {money(r.totalPaye)}
                    </span>
                  </button>
                </li>
              ))}
              {runs.length === 0 && <li className="text-sm text-oat">No months computed yet.</li>}
            </ul>
          </section>

          {run && (
            <section className="card p-6 rise rise-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-xl tabular">{run.period}</h2>
                <div className="flex flex-wrap gap-2">
                  {run.status === 'DRAFT' ? (
                    <Button onClick={() => setConfirmingApproval(true)}>Approve month</Button>
                  ) : (
                    <>
                      <a
                        href={`/api/proxy/payroll/runs/${run.id}/payout?method=BANK`}
                        className="min-h-9 inline-flex items-center rounded-full border border-brand text-brand px-3 text-[12px] font-medium hover:bg-brand hover:text-white transition"
                      >
                        Bank file
                      </a>
                      <a
                        href={`/api/proxy/payroll/runs/${run.id}/payout?method=MOMO`}
                        className="min-h-9 inline-flex items-center rounded-full border border-brand text-brand px-3 text-[12px] font-medium hover:bg-brand hover:text-white transition"
                      >
                        MoMo file
                      </a>
                    </>
                  )}
                </div>
              </div>

              {/*
                The stop: names the month, counts the people and the money, and says what freezing
                means. In the page rather than a native dialog, so it cannot be suppressed by the
                browser — and so declining is just a dismissal, not a failure.
              */}
              {confirmingApproval && run.status === 'DRAFT' && (
                <div className="mt-4 rounded-lg border border-gold/40 bg-gold/5 p-4">
                  <p className="font-medium">
                    Approve {run.period} — {run.lines.length} staff, {money(runNet)} net?
                  </p>
                  <p className="text-[13px] text-oat mt-1.5 max-w-prose">
                    The figures freeze. A later change to somebody&apos;s salary will not touch this
                    month, and the payslips and payout files are generated from what is frozen here.
                  </p>
                  <div className="flex flex-wrap items-center gap-3 mt-4">
                    <Button
                      onClick={approve.run}
                      state={approve.state}
                      pendingLabel="Approving…"
                      doneLabel="Approved!"
                      failedLabel="Couldn't approve"
                    >
                      {`Yes, approve ${run.period}`}
                    </Button>
                    <button
                      onClick={() => setConfirmingApproval(false)}
                      className="min-h-11 px-3 text-sm text-oat hover:text-brand transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <ul className="mt-4 space-y-2">
                {run.lines.map((l) => (
                  <li
                    key={l.userId}
                    className="flex items-center justify-between gap-3 border-b border-mist/50 last:border-0 pb-2 last:pb-0"
                  >
                    <div>
                      <p className="text-sm font-medium">{l.staffName}</p>
                      <p className="text-[11px] text-oat tabular">
                        gross {money(l.gross)} · SSNIT {money(l.ssnitEmployee)} · PAYE{' '}
                        {money(l.paye)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-medium tabular">{money(l.net)}</span>
                      <a
                        href={`/api/proxy/payroll/runs/${run.id}/payslips/${l.userId}`}
                        className="text-[12px] text-brand hover:underline underline-offset-2"
                      >
                        Payslip
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
