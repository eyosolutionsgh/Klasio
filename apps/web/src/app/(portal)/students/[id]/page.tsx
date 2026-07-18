import Link from 'next/link';
import { api, money } from '@/lib/api';
import StudentLifecycle from '@/components/StudentLifecycle';
import StudentFiles from '@/components/StudentFiles';
import StudentGuardians from '@/components/StudentGuardians';

interface Detail {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  status: string;
  enrolledAt: string;
  exitDate: string | null;
  exitReason: string | null;
  photoUrl?: string | null;
  className: string | null;
  guardians: {
    id: string;
    name: string;
    phone: string;
    relationship: string;
    isPrimary: boolean;
    canPickup: boolean;
    custodyFlag: string;
    whatsappOptIn: boolean;
    alsoGuardianTo: number;
  }[];
  feeBalance: number;
  ledger: {
    id: string;
    type: string;
    amount: number;
    method: string | null;
    reference: string;
    receiptNumber: string | null;
    note: string | null;
    createdAt: string;
  }[];
  attendanceSummary: Record<string, number>;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function StudentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await api<Detail>(`/students/${id}`);
  const att = s.attendanceSummary;
  const attTotal = Object.values(att).reduce((a, b) => a + b, 0);

  return (
    <div>
      <Link href="/students" className="no-print text-[13px] text-oat hover:text-brand transition">
        ← Back to students
      </Link>

      <div className="rise rise-1 mt-4 flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 rounded-full bg-brand text-paper font-display text-2xl flex items-center justify-center">
            {s.firstName[0]}
            {s.lastName[0]}
          </div>
          <div>
            <h1 className="font-display text-3xl flex items-center gap-3">
              {s.firstName} {s.lastName}
              {s.status !== 'ACTIVE' && (
                <span className="text-[10px] uppercase tracking-wider bg-parchment text-oat rounded-full px-2.5 py-1 align-middle">
                  {s.status.toLowerCase()}
                </span>
              )}
            </h1>
            <p className="text-sm text-oat mt-1 tabular">
              {s.admissionNo} · {s.className ?? 'Unassigned'} ·{' '}
              {s.gender === 'MALE' ? 'Boy' : 'Girl'} · Born {fmtDate(s.dateOfBirth)}
            </p>
            {s.status !== 'ACTIVE' && s.exitDate && (
              <p className="text-xs text-oat mt-1">
                Left {fmtDate(s.exitDate)}
                {s.exitReason ? ` · ${s.exitReason}` : ''}
              </p>
            )}
          </div>
        </div>
        <div
          data-tip="Invoices minus payments across all terms"
          className={`tip card px-5 py-3 text-right ${s.feeBalance > 0 ? 'border-clay/40' : ''}`}
        >
          <p className="text-[11px] uppercase tracking-widest text-oat">Fee balance</p>
          <p
            className={`font-display text-2xl tabular mt-1 ${s.feeBalance > 0 ? 'text-clay' : 'text-leaf'}`}
          >
            {money(s.feeBalance)}
          </p>
        </div>
      </div>

      {s.status === 'ACTIVE' && (
        <div className="no-print mt-6 rise rise-2">
          <StudentLifecycle studentId={s.id} name={`${s.firstName} ${s.lastName}`} />
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_1.3fr] gap-6 mt-8">
        <div className="space-y-6">
          <StudentGuardians studentId={s.id} guardians={s.guardians} />

          <StudentFiles studentId={s.id} hasPhoto={!!s.photoUrl} />

          {/* Attendance summary */}
          <section className="card p-6 rise rise-3">
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
                {Math.round((((att.PRESENT ?? 0) + (att.LATE ?? 0)) / attTotal) * 100)}% attendance
                across {attTotal} marked days
              </p>
            )}
          </section>
        </div>

        {/* Ledger */}
        <section className="card p-6 rise rise-3">
          <h2 className="font-display text-xl">Fee ledger</h2>
          <p className="text-xs text-oat mt-1">
            Every charge and payment, newest first. Corrections appear as reversals.
          </p>
          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist">
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Entry</th>
                <th className="py-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {s.ledger.map((e) => (
                <tr key={e.id} className="border-b border-mist/50 last:border-0">
                  <td className="py-2.5 text-oat tabular whitespace-nowrap">
                    {fmtDate(e.createdAt)}
                  </td>
                  <td className="py-2.5">
                    <p className="font-medium text-[13px]">
                      {e.type === 'INVOICE'
                        ? 'Invoice'
                        : e.type === 'PAYMENT'
                          ? `Payment · ${e.method}`
                          : e.type}
                    </p>
                    <p className="text-[11px] text-oat tabular">
                      {e.reference}
                      {e.receiptNumber && ` · ${e.receiptNumber}`}
                    </p>
                    {e.type === 'PAYMENT' && e.receiptNumber && (
                      <a
                        href={`/api/proxy/fees/receipts/${e.reference}/pdf`}
                        className="no-print text-[11px] text-brand hover:underline underline-offset-2"
                      >
                        Download receipt ↓
                      </a>
                    )}
                  </td>
                  <td
                    className={`py-2.5 text-right tabular font-medium ${e.type === 'INVOICE' ? 'text-ink' : 'text-leaf'}`}
                  >
                    {e.type === 'INVOICE' ? '' : '−'}
                    {money(e.amount)}
                  </td>
                </tr>
              ))}
              {s.ledger.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-oat">
                    No ledger entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
