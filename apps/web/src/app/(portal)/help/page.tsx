import Link from 'next/link';
import { getMe } from '@/lib/api';

const FAQ = [
  {
    q: 'A guardian says they cannot sign in.',
    a: 'Check the phone number on the student’s record matches the one they are typing — any format works (024…, +233 24…), but it must be the same number. If it is right and no code arrives, the school’s SMS credit may be exhausted; see Messaging.',
  },
  {
    q: 'A guardian cannot see a terminal report.',
    a: 'Reports appear to guardians only once published. Open Terminal Reports, confirm the class and term, and check the report shows as published.',
  },
  {
    q: 'Someone was billed twice / not at all.',
    a: 'Generating the term bills skips anyone already billed for that term, so re-running it is safe. If an amount is genuinely wrong, record a reversal rather than editing — the ledger is append-only by design and the audit trail must stay intact.',
  },
  {
    q: 'A member of staff has left.',
    a: 'Staff & Access → set them inactive. Their sign-in stops working immediately, including any session already open, and their past entries stay attributed to them in the audit log.',
  },
  {
    q: 'How many students can we enrol?',
    a: 'As many as you have. Your package decides which features are switched on, never how big your school may be, so a new intake never needs a licence change. Withdrawing or graduating a child keeps the register tidy, and their record stays readable and exportable either way.',
  },
];

export default async function HelpPage() {
  const me = await getMe();
  return (
    <div className="max-w-3xl">
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Help &amp; support</h1>
        <p className="text-sm text-oat mt-1.5">
          Common questions first — if none of these fit, get in touch.
        </p>
      </div>

      <section className="card p-6 mt-6 rise rise-2">
        <h2 className="font-display text-xl">Frequently asked</h2>
        <dl className="mt-4 space-y-4">
          {FAQ.map((f) => (
            <div key={f.q} className="border-b border-mist/50 last:border-0 pb-4 last:pb-0">
              <dt className="text-sm font-medium">{f.q}</dt>
              <dd className="text-sm text-oat mt-1">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card p-6 mt-6 rise rise-3">
        <h2 className="font-display text-xl">Still stuck?</h2>
        <p className="text-sm text-oat mt-1.5">
          Read the{' '}
          <Link href="/guide" className="text-brand underline underline-offset-2">
            user guide
          </Link>{' '}
          for step-by-step walkthroughs, or contact Klasio support.
        </p>
        <div className="mt-4 grid sm:grid-cols-2 gap-4 text-sm">
          <p>
            <span className="block text-[11px] uppercase tracking-wider text-oat">Email</span>
            <a
              href="mailto:support@eyosolutions.com"
              className="inline-flex items-center min-h-11 text-brand underline underline-offset-2"
            >
              support@eyosolutions.com
            </a>
          </p>
          <p>
            <span className="block text-[11px] uppercase tracking-wider text-oat">
              Your school on record
            </span>
            <span className="inline-flex items-center min-h-11">
              {me.school.name}
              {me.school.phone ? ` · ${me.school.phone}` : ''}
            </span>
          </p>
        </div>
        <p className="text-[11px] text-oat mt-2">
          Quote your school name when you write — it helps support find your account.
        </p>
      </section>
    </div>
  );
}
