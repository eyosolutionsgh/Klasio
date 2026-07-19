import PayAction from '@/components/PayAction';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface PublicIntent {
  reference: string;
  amount: number;
  currency: string;
  status: string;
  channel: string;
  school: { name: string; logoUrl: string | null };
  student: { name: string; className: string | null };
}

/**
 * Public fee-payment page. Guardians are not users and have no login, so this page is
 * reachable by a high-entropy token alone (docs/03 §3.7 unique payment reference per invoice).
 */
export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await fetch(`${API_URL}/payments/public/${token}`, { cache: 'no-store' });

  if (!res.ok) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6">
        <div className="card max-w-md w-full p-8 text-center">
          <p className="font-display text-2xl">Link not valid</p>
          <p className="text-sm text-oat mt-2">
            This payment link has expired or was mistyped. Please ask the school for a new one.
          </p>
        </div>
      </main>
    );
  }
  const intent: PublicIntent = await res.json();
  const money = `${intent.currency} ${intent.amount.toLocaleString('en-GH', { minimumFractionDigits: 2 })}`;
  const settled = intent.status === 'SUCCESS';

  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <div className="card max-w-md w-full p-8 relative overflow-hidden">
        <div className="accent-rule h-[3px] absolute top-0 left-0 right-0" />
        <p className="font-display text-2xl mt-2">{intent.school.name}</p>
        <p className="text-sm text-oat mt-1">School fees payment</p>

        <dl className="mt-6 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-oat">Student</dt>
            <dd className="font-medium">{intent.student.name}</dd>
          </div>
          {intent.student.className && (
            <div className="flex justify-between">
              <dt className="text-oat">Class</dt>
              <dd className="font-medium">{intent.student.className}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-oat">Reference</dt>
            <dd className="font-medium tabular text-xs">{intent.reference}</dd>
          </div>
        </dl>

        <div className="mt-6 rounded-lg bg-parchment/70 p-5 text-center">
          <p className="text-[11px] uppercase tracking-widest text-oat">Amount due</p>
          <p className="font-display text-3xl tabular mt-1">{money}</p>
        </div>

        {settled ? (
          <p className="mt-6 text-center text-sm text-leaf bg-leaf/10 border border-leaf/20 rounded-lg px-3 py-2">
            This payment has been received. Thank you.
          </p>
        ) : (
          <PayAction token={token} reference={intent.reference} />
        )}

        <p className="mt-6 text-[11px] text-oat text-center">
          Secured by Klasio School Management. Never share this link publicly.
        </p>
      </div>
    </main>
  );
}
