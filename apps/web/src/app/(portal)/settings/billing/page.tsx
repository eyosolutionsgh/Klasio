import { api, getMe, money } from '@/lib/api';
import BillingAction from '@/components/BillingAction';

interface Plan {
  tier: 'BASIC' | 'MEDIUM' | 'ADVANCED';
  studentCount: number;
  /** Per-student × roll, before the floor and cap. Shown so the price is never a bare assertion. */
  subtotal: number;
  amount: number;
  currency: string;
  applied: 'floor' | 'cap' | null;
  perStudent: number;
  current: boolean;
}

interface Plans {
  currentTier: string;
  studentCount: number;
  currency: string;
  subscription: {
    tier: string;
    status: string;
    amount: number;
    periodStart: string;
    periodEnd: string;
    pendingTier: string | null;
    /** False once the grace period after `periodEnd` has run out. */
    entitled: boolean;
  } | null;
  plans: Plan[];
}

interface SubInvoice {
  id: string;
  reference: string;
  tier: string;
  amount: number;
  currency: string;
  studentCount: number;
  periodStart: string;
  periodEnd: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';
  paidAt: string | null;
}

const RANK: Record<string, number> = { BASIC: 0, MEDIUM: 1, ADVANCED: 2 };

const BLURB: Record<string, string> = {
  BASIC: 'Students, attendance, terminal reports and the fee ledger. Free at any size.',
  MEDIUM: 'Adds online fee payment, bulk SMS to guardians, timetabling and the guardian portal.',
  ADVANCED: 'Adds admissions, dismissal safety, reconciliation, GES returns and shared resources.',
};

const day = (d: string) =>
  new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'long', year: 'numeric' });

const STATUS_TONE: Record<string, string> = {
  PAID: 'bg-leaf/10 text-leaf',
  PENDING: 'bg-clay/10 text-clay',
  FAILED: 'bg-danger/10 text-danger',
  CANCELLED: 'bg-parchment text-oat',
};

/**
 * How a plan's price was arrived at, in words.
 *
 * `subtotal` exists precisely so a school can check the arithmetic, so a floor or a cap is
 * stated rather than hidden behind a rounded number that looks arbitrary.
 */
function derivation(p: Plan) {
  const cur = p.currency;
  if (p.tier === 'BASIC') return 'Free — no charge whatever the roll.';
  const raw = `${p.studentCount} student${p.studentCount === 1 ? '' : 's'} × ${money(p.perStudent, cur)}`;
  if (p.applied === 'floor') {
    return `Minimum charge. ${raw} would be ${money(p.subtotal, cur)}, which is below the ${money(p.amount, cur)} minimum, so ${money(p.amount, cur)} is what you pay.`;
  }
  if (p.applied === 'cap') {
    return `Capped. ${raw} would be ${money(p.subtotal, cur)}, but nobody pays more than ${money(p.amount, cur)} a term.`;
  }
  return `${raw} per term.`;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  const [data, invoices, me] = await Promise.all([
    api<Plans>('/billing/plans'),
    api<SubInvoice[]>('/billing/invoices'),
    getMe(),
  ]);

  // The API puts @Roles('OWNER') on subscribe and change-tier. Hiding the controls for anyone
  // else is presentation only — the API refuses regardless — but a button that always 403s is
  // worse than no button.
  const canManage = me.user.role === 'OWNER';
  const sub = data.subscription;
  const cur = data.currency;
  const lapsed = sub !== null && !sub.entitled;

  // Set when the gateway bounced the browser back here. The tier has not moved yet either way:
  // only the webhook settles it, so this says "we are waiting", never "you are upgraded".
  const returned = ref ? invoices.find((i) => i.reference === ref) : undefined;

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Subscription</h1>
        <p className="text-sm text-oat mt-1.5">
          What {me.school.name} pays Klasio, per term, for the package it is on. Priced per active
          student — {data.studentCount} today — with a minimum so a very small school is affordable
          and a cap so a large one is not punished for growing.
        </p>
      </div>

      {returned && (
        <div
          role="status"
          className={`card p-5 mt-6 rise rise-2 border-l-4 ${returned.status === 'PAID' ? 'border-l-leaf' : 'border-l-clay'}`}
        >
          <p className="text-sm font-medium">
            {returned.status === 'PAID'
              ? `Payment ${returned.reference} confirmed — you are on ${returned.tier}.`
              : `Payment ${returned.reference} has not been confirmed yet.`}
          </p>
          {returned.status !== 'PAID' && (
            <p className="text-[12.5px] text-oat mt-1">
              We only move a school onto a plan when the gateway tells us the money arrived, which
              can lag a minute or two behind the payment screen. Nothing has changed yet; refresh
              this page shortly. If it never confirms, no charge stands.
            </p>
          )}
        </div>
      )}

      {sub?.pendingTier && (
        <div role="status" className="card p-5 mt-6 rise rise-2 border-l-4 border-l-clay">
          <p className="text-sm font-medium">
            You are on {data.currentTier} until {day(sub.periodEnd)}, then moving to{' '}
            {sub.pendingTier}.
          </p>
          <p className="text-[12.5px] text-oat mt-1">
            Nothing is taken away before then — the term is already paid for, so every{' '}
            {data.currentTier} feature keeps working until that date. To stay on {data.currentTier},
            pay for it below and the scheduled change is dropped.
          </p>
        </div>
      )}

      {lapsed && (
        <div role="alert" className="card p-5 mt-6 rise rise-2 border-l-4 border-l-danger">
          <p className="text-sm font-medium text-danger">
            This subscription has lapsed — the paid period ended on {day(sub.periodEnd)} and the
            grace period after it has run out.
          </p>
          <p className="text-[12.5px] text-oat mt-1">
            Your records are not locked and nothing has been deleted. Pay for a plan below to put
            the package back.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        {[
          {
            label: 'Current package',
            value: data.currentTier,
            tip: 'What this school is on today',
          },
          {
            label: 'Active students',
            value: String(data.studentCount),
            tip: 'The roll every price on this page is worked out from',
          },
          {
            label: 'Paid this term',
            value: sub ? money(sub.amount, cur) : '—',
            tip: sub ? 'The amount the current period was billed at' : 'No subscription on file',
          },
          {
            label: 'Period ends',
            value: sub ? day(sub.periodEnd) : '—',
            tip: sub
              ? 'A term is the billing period, matching how schools budget'
              : 'Nothing to renew',
            tone: lapsed ? 'text-danger' : undefined,
          },
        ].map((s, i) => (
          <div
            key={s.label}
            data-tip={s.tip}
            className={`tip card card-accent p-5 rise rise-${i + 1}`}
          >
            <p className="text-[11px] uppercase tracking-widest text-oat">{s.label}</p>
            <p className={`font-display text-2xl mt-2 ${s.tone ?? 'text-ink'}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {sub && (
        <p className="text-[12.5px] text-oat mt-3">
          Period {day(sub.periodStart)} → {day(sub.periodEnd)} · billing status {sub.status}
          {sub.status === 'CANCELLING' && ' (will not renew)'}
          {sub.status === 'PAST_DUE' &&
            ' — renewal has not cleared, but nothing has been switched off'}
        </p>
      )}

      <div className="grid md:grid-cols-3 gap-5 mt-8">
        {data.plans.map((p, i) => {
          const direction =
            RANK[p.tier] > RANK[data.currentTier] ? ('upgrade' as const) : ('downgrade' as const);
          return (
            <section
              key={p.tier}
              className={`card p-6 rise rise-${i + 1} flex flex-col ${p.current ? 'ring-2 ring-brand' : ''}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-display text-xl">{p.tier}</h2>
                {p.current && (
                  <span className="text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 bg-brand/10 text-brand">
                    Current
                  </span>
                )}
              </div>

              <p className="font-display text-3xl mt-3 tabular">
                {p.amount === 0 ? 'Free' : money(p.amount, p.currency)}
              </p>
              <p className="text-[11px] uppercase tracking-widest text-oat mt-1">per term</p>

              {/* The whole point of `subtotal`: the number above is never just asserted. */}
              <p className="text-[12.5px] text-oat mt-3 leading-relaxed">{derivation(p)}</p>

              <p className="text-[12.5px] mt-3 leading-relaxed">{BLURB[p.tier]}</p>

              <div className="flex-1" />

              {p.current ? (
                <p className="mt-4 text-[12.5px] text-oat">
                  This is the package you are on
                  {sub?.pendingTier ? `, until ${day(sub.periodEnd)}.` : '.'}
                </p>
              ) : sub?.pendingTier === p.tier ? (
                // A scheduled move is a fact worth stating to anyone who can see this page,
                // so it outranks the "owner only" notice below.
                <p className="mt-4 text-[12.5px] text-clay">
                  Already scheduled for {day(sub.periodEnd)}.
                </p>
              ) : !canManage ? (
                <p
                  className="tip mt-4 text-[12.5px] text-oat"
                  data-tip="The API allows only the school owner to commit the school to a bill"
                >
                  Only the school owner can change the package.
                </p>
              ) : direction === 'upgrade' ? (
                <BillingAction
                  tier={p.tier}
                  amount={p.amount}
                  currency={p.currency}
                  direction="upgrade"
                  currentTier={data.currentTier}
                  periodEnd={sub?.periodEnd ?? null}
                  defaultPhone={me.school.phone}
                />
              ) : (
                <BillingAction
                  tier={p.tier}
                  amount={p.amount}
                  currency={p.currency}
                  direction="downgrade"
                  currentTier={data.currentTier}
                  periodEnd={sub?.periodEnd ?? null}
                  defaultPhone={me.school.phone}
                />
              )}
            </section>
          );
        })}
      </div>

      <div className="card mt-8 overflow-hidden rise rise-4">
        <div className="px-6 pt-5 pb-3">
          <h2 className="font-display text-xl">Subscription invoices</h2>
          <p className="text-xs text-oat mt-1">
            What Klasio has charged this school. Separate from the fees you bill guardians — the two
            are never summed together.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[620px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
                <th className="px-6 py-2.5 font-medium">Reference</th>
                <th className="px-3 py-2.5 font-medium">Package</th>
                <th className="px-3 py-2.5 font-medium">Period</th>
                <th className="px-3 py-2.5 font-medium text-right">Students</th>
                <th className="px-3 py-2.5 font-medium text-right">Amount</th>
                <th className="px-6 py-2.5 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-mist/60 last:border-0">
                  <td className="px-6 py-3 tabular font-medium">{inv.reference}</td>
                  <td className="px-3 py-3">{inv.tier}</td>
                  <td className="px-3 py-3 text-oat text-[12.5px] whitespace-nowrap">
                    {day(inv.periodStart)} → {day(inv.periodEnd)}
                  </td>
                  <td className="px-3 py-3 text-right tabular">{inv.studentCount}</td>
                  <td className="px-3 py-3 text-right tabular whitespace-nowrap">
                    {money(inv.amount, inv.currency)}
                  </td>
                  <td className="px-6 py-3">
                    <span
                      className={`text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 ${STATUS_TONE[inv.status] ?? 'bg-parchment text-oat'}`}
                    >
                      {inv.status}
                    </span>
                    {inv.paidAt && (
                      <span className="block text-[11px] text-oat mt-0.5">{day(inv.paidAt)}</span>
                    )}
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-oat">
                    Nothing has been charged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
