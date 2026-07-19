'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, useAsyncAction } from './Button';
import { CashIcon, TrashIcon } from './icons';

interface Award {
  id: string;
  ruleId: string;
  name: string;
  basis: 'PERCENT' | 'AMOUNT';
  value: number;
  /** The *rule's* active flag. The award still stands when false; nothing is applied. */
  active: boolean;
  reason: string;
  awardedAt: string;
}
interface Preview {
  siblingRank: number;
  applied: { ruleId: string; name: string; amount: number }[];
  total: number;
  payable: number;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });

function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${tail}`;
}

/**
 * The nominal bill the "is it reaching this child?" probe is priced against.
 *
 * Whether a rule reaches a child has to be asked separately from what it is worth today: a child
 * with nothing owing would otherwise look as though no rule touched them, because a concession
 * against a bill of nothing is nothing. Sibling rank comes from the same probe.
 */
const PROBE = 1000;

const field =
  'rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

/**
 * What one child is let off, and why.
 *
 * Two lists, because they answer different questions and a school needs both. **Scholarships on
 * file** is every award this child holds, including ones currently applying to nothing — an award
 * the portal hides is an award nobody can revoke. **What that comes to today** is the arithmetic
 * against a bill. Neither is a balance: the ledger stays the only record of what is owed.
 */
export default function StudentConcessions({
  studentId,
  studentName,
  balance,
  canManage,
  currency,
}: {
  studentId: string;
  studentName: string;
  balance: number;
  canManage: boolean;
  currency: string;
}) {
  const money = (n: number) =>
    `${currency} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const [awards, setAwards] = useState<Award[] | null>(null);
  const [probe, setProbe] = useState<Preview | null>(null);
  const [live, setLive] = useState<Preview | null>(null);
  const [amount, setAmount] = useState(String(balance > 0 ? balance : PROBE));
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const preview = useCallback(
    async (value: number): Promise<Preview | null> => {
      const res = await fetch(`/api/proxy/fees/concessions/preview/${studentId}?amount=${value}`);
      return res.ok ? ((await res.json()) as Preview) : null;
    },
    [studentId],
  );

  const load = useCallback(async () => {
    // A 403 on either means the package does not include concessions, so the section is not part
    // of this school's portal at all rather than a locked door.
    const [a, p] = await Promise.all([
      fetch(`/api/proxy/fees/concessions/awards?studentId=${studentId}`).then((r) =>
        r.ok ? r.json() : null,
      ),
      preview(PROBE),
    ]);
    setAwards(a);
    setProbe(p);
    setLoaded(true);
  }, [studentId, preview]);

  useEffect(() => {
    load();
  }, [load]);

  // The typed amount is a question asked of the API, not a sum done here — the cap and the
  // ordering that decides which concession gets truncated live in one place, server-side.
  useEffect(() => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setLive(null);
      return;
    }
    const t = setTimeout(() => {
      preview(n).then(setLive);
    }, 300);
    return () => clearTimeout(t);
  }, [amount, preview]);

  // Only one award is ever being confirmed at a time, so a single action state serves the list.
  const revoke = useAsyncAction(async (award: Award) => {
    setError(null);
    const res = await fetch(`/api/proxy/fees/concessions/awards/${award.id}`, { method: 'DELETE' });
    setConfirming(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(
        Array.isArray(body.message)
          ? body.message.join('. ')
          : (body.message ?? 'Could not revoke that scholarship.'),
      );
      throw new Error('rejected');
    }
    load();
    preview(Number(amount) || PROBE).then(setLive);
  });

  if (!loaded || !awards || !probe) return null;

  const applying = new Set(probe.applied.map((a) => a.ruleId));
  // Anything reaching this child that nobody awarded them is a sibling discount, by definition.
  const siblingRule = probe.applied.find((a) => !awards.some((w) => w.ruleId === a.ruleId));
  const worth = (a: Award) =>
    a.basis === 'PERCENT' ? `${a.value}% of each bill` : `${money(a.value)} off`;

  return (
    <section className="card p-6 rise rise-3">
      <h2 className="font-display text-xl">Concessions</h2>
      <p className="text-sm text-oat mt-1.5">
        What {studentName} is let off, and why. This is the policy that will be applied the next
        time this child is billed — the ledger opposite is the record of what has actually been
        billed.
      </p>

      <div className="mt-4 rounded-lg bg-parchment/60 px-3.5 py-3">
        <p className="text-sm">
          <span className="font-medium">{ordinal(probe.siblingRank)} child</span> of this family on
          the roll
          {probe.siblingRank === 1 && ' — the eldest, who pays in full'}.
        </p>
        <p className="text-[11px] text-oat mt-1">
          Ranked by enrolment date across every family a guardian has here, eldest first. Enrolling
          a younger sibling never re-ranks the children already being billed.
          {siblingRule &&
            ` ${siblingRule.name} reaches this child automatically — nobody awarded it.`}
        </p>
      </div>

      <h3 className="text-sm font-medium mt-5">Scholarships on file</h3>
      {awards.length > 0 ? (
        <ul className="mt-2 space-y-3">
          {awards.map((a) => {
            // Three states worth telling apart: applying, rule switched off, and reaching nothing
            // today because of its dates or its level. Only the first costs the school money, but
            // all three are held awards and all three must be revocable.
            const dormant = !a.active
              ? 'The rule is deactivated — nothing is being applied'
              : applying.has(a.ruleId)
                ? null
                : "Not reaching this child at the moment — the rule's dates or level exclude them";
            return (
              <li key={a.id} className="border-b border-mist/50 last:border-0 pb-3 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className={`text-sm font-medium ${dormant ? 'text-oat' : ''}`}>
                    {a.name}
                  </span>
                  <span className="text-[13px] text-oat tabular shrink-0">{worth(a)}</span>
                </div>
                <p className="text-[13px] text-oat mt-0.5">{a.reason}</p>
                <p className="text-[11px] text-oat mt-0.5">
                  Awarded {fmtDate(a.awardedAt)}
                  {dormant && <span className="block text-clay">{dormant}</span>}
                </p>
                {canManage && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {confirming === a.id ? (
                      <>
                        {/* "Yes," is not a verb, so the working wording is spelled out. */}
                        <Button
                          onClick={() => revoke.run(a)}
                          state={revoke.state}
                          variant="danger"
                          size="sm"
                          icon={<TrashIcon />}
                          className="no-print"
                          pendingLabel="Revoking…"
                          doneLabel="Revoked!"
                          failedLabel="Couldn't revoke"
                        >
                          Yes, revoke it
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="no-print"
                          onClick={() => setConfirming(null)}
                        >
                          Keep it
                        </Button>
                        <span className="text-[11px] text-oat">
                          The reason above is not kept once it is revoked.
                        </span>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<TrashIcon />}
                        onClick={() => {
                          setError(null);
                          setConfirming(a.id);
                        }}
                        data-tip="Stops it from the next bill; discounts already given stand"
                        className="tip no-print"
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-oat mt-2">
          No scholarship has been awarded to this child — they are billed in full, less any sibling
          discount above.
        </p>
      )}
      {error && <p className="text-sm text-danger mt-2">{error}</p>}
      <p className="text-[11px] text-oat mt-2">
        Awarded from the fee settings page. Revoking one only changes future terms: the discounts
        already written against billed terms were correct when those terms were billed, and the fee
        ledger is append-only — they stand.
      </p>

      <div className="mt-5 pt-5 border-t border-mist/60">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-sm font-medium">What that comes to today</h3>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Against a bill of ({currency})</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                <CashIcon />
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`${field} w-36 pl-10 tabular`}
              />
            </div>
          </label>
        </div>

        {live && live.applied.length > 0 ? (
          <>
            <ul className="mt-3 space-y-2">
              {live.applied.map((a) => (
                <li key={a.ruleId} className="flex items-baseline justify-between gap-3 text-sm">
                  <span>
                    {a.name}
                    <span className="ml-2 text-[11px] text-oat">
                      {awards.some((w) => w.ruleId === a.ruleId) ? 'awarded' : 'automatic'}
                    </span>
                  </span>
                  <span className="tabular text-leaf shrink-0">−{money(a.amount)}</span>
                </li>
              ))}
            </ul>
            <p className="text-[13px] mt-3 pt-3 border-t border-mist/60">
              Let off <span className="tabular font-medium text-leaf">{money(live.total)}</span> ·
              payable <span className="tabular font-medium">{money(live.payable)}</span>
              {live.applied.length > 1 && (
                <span className="block text-[11px] text-oat mt-1">
                  Both rules apply — each is taken from the {money(Number(amount))} bill, not from
                  what the other leaves. The total can never exceed the bill.
                </span>
              )}
            </p>
          </>
        ) : (
          <p className="text-sm text-oat mt-3">
            {Number(amount) > 0
              ? 'Nothing is let off — this child is billed the full amount.'
              : 'Enter a bill amount to see what would be let off.'}
          </p>
        )}
        <p className="text-[11px] text-oat mt-3">
          A preview only. Concessions are written to the ledger when the term&apos;s bills are
          generated, and what was written then stands even if a rule changes later.
        </p>
      </div>
    </section>
  );
}
