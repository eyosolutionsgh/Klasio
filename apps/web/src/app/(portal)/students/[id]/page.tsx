import Link from 'next/link';
import { api, getMe, money } from '@/lib/api';
import DownloadButton from '@/components/DownloadButton';
import InstallmentPlan from '@/components/InstallmentPlan';
import StudentLifecycle from '@/components/StudentLifecycle';
import StudentFiles from '@/components/StudentFiles';
import StudentGuardians, { type GuardianLink } from '@/components/StudentGuardians';
import StudentExtras from '@/components/StudentExtras';
import MedicalNotes from '@/components/MedicalNotes';
import StudentCustomFields from '@/components/StudentCustomFields';
import StudentChecklist from '@/components/StudentChecklist';
import GrantConcession from '@/components/GrantConcession';
import StudentConcessions from '@/components/StudentConcessions';
import PickupList from '@/components/PickupList';
import CumulativeRecord from '@/components/CumulativeRecord';
import ReverseEntry from '@/components/ReverseEntry';
import StudentPortalAccess from '@/components/StudentPortalAccess';
import EditStudent from '@/components/EditStudent';

/** One place for the human words, so a guardian and a bursar never read different labels. */
const METHOD_LABEL: Record<string, string> = {
  MOMO: 'Mobile Money',
  CASH: 'Cash',
  BANK: 'Bank transfer',
  CARD: 'Card',
};

const LEDGER_LABEL = (type: string, method?: string | null) => {
  if (type === 'PAYMENT') return `Payment${method ? ` · ${METHOD_LABEL[method] ?? method}` : ''}`;
  if (type === 'INVOICE') return 'School bill';
  if (type === 'DISCOUNT') return 'Discount';
  if (type === 'WAIVER') return 'Waiver';
  if (type === 'REVERSAL') return 'Correction — entry reversed';
  return type;
};

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
  /** Absent without `students.medical` — the nurse holds that, the librarian does not. */
  medicalNotes?: string | null;
  className: string | null;
  /**
   * The one `GuardianLink` rather than a second copy of its shape. Declared inline, this drifted:
   * `phone` and `whatsappOptIn` stayed required here after the component had already made them
   * optional, so the page kept promising fields the API omits.
   */
  guardians: GuardianLink[];
  otherNames: string | null;
  classId: string | null;
  /**
   * Money is gated on `fees.view`, so both of these are **absent** for a role that may read a
   * child's record but not the school's finances — a Librarian, School Nurse, Subject Teacher or
   * Exams Officer. Read as required, `s.ledger.map(...)` throws and takes the page down for all
   * of them, which is the same failure the custody fields had one field over.
   *
   * They travel together: the API decides both on the one check, so the fee card, the payment
   * plan and the ledger are shown or omitted as a set.
   */
  feeBalance?: number;
  hasPortalPin: boolean;
  ledger?: {
    id: string;
    type: string;
    amount: number;
    method: string | null;
    reference: string;
    receiptNumber: string | null;
    note: string | null;
    createdAt: string;
    reversedId: string | null;
    reversed: boolean;
  }[];
  attendanceSummary: Record<string, number>;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function StudentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [s, me] = await Promise.all([api<Detail>(`/students/${id}`), getMe()]);
  const canReverse = me.permissions?.includes('fees.reverse') ?? false;
  const canEditStudent = me.permissions?.includes('students.edit') ?? false;
  const canEditLifecycle = me.permissions?.includes('students.lifecycle') ?? false;
  const att = s.attendanceSummary;
  const attTotal = Object.values(att).reduce((a, b) => a + b, 0);
  // Both are presentation only — the API refuses either way. Hiding them keeps a teacher from
  // triggering a 403 that would read as the portal breaking.
  const canPlan = ['OWNER', 'HEAD', 'BURSAR'].includes(me.user.role);
  // A bursar may read a child's scholarships but not revoke one — awarding and revoking are the
  // head's call, so the button is hidden rather than left to 403.
  const canAwardConcessions = ['OWNER', 'HEAD'].includes(me.user.role);
  const canPrintCard =
    ['OWNER', 'HEAD', 'FRONT_DESK'].includes(me.user.role) &&
    me.entitlements.includes('sis.idcards');

  /**
   * Narrowed once, here, rather than at each use. The API sends both or neither, so binding them
   * together keeps the fee card, the payment plan and the ledger from disagreeing about whether
   * this reader may see money.
   */
  const balance = s.feeBalance;
  const ledger = s.ledger;
  const mayReadFees = balance !== undefined && ledger !== undefined;

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
              {s.gender === 'MALE' ? 'Male' : 'Female'} · Born {fmtDate(s.dateOfBirth)}
            </p>
            {canEditStudent && (
              <div className="mt-1.5">
                <EditStudent
                  studentId={s.id}
                  student={{
                    firstName: s.firstName,
                    lastName: s.lastName,
                    otherNames: s.otherNames,
                    gender: s.gender,
                    dateOfBirth: s.dateOfBirth,
                    classId: s.classId ?? null,
                  }}
                />
              </div>
            )}
            {s.status !== 'ACTIVE' && s.exitDate && (
              <p className="text-xs text-oat mt-1">
                Left {fmtDate(s.exitDate)}
                {s.exitReason ? ` · ${s.exitReason}` : ''}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* No card at all without `fees.view` — a balance of GHS 0.00 would be a lie. */}
          {balance !== undefined && (
            <div
              data-tip="Bills minus payments across all terms"
              className={`tip card px-5 py-3 text-right ${balance > 0 ? 'border-clay/40' : ''}`}
            >
              <p className="text-[11px] uppercase tracking-widest text-oat">Fee balance</p>
              <p
                className={`font-display text-2xl tabular mt-1 ${balance > 0 ? 'text-clay' : 'text-leaf'}`}
              >
                {money(balance)}
              </p>
            </div>
          )}
          {balance !== undefined && (
            <div className="no-print">
              <DownloadButton
                path={`/fees/students/${s.id}/statement.pdf`}
                filename={`statement-${s.admissionNo}.pdf`}
                label="Statement"
                variant="ghost"
                tip="Full statement of account — every charge, payment and correction, with a running balance"
              />
            </div>
          )}
          {canPrintCard && s.status === 'ACTIVE' && (
            <div className="no-print">
              <DownloadButton
                path={`/students/id-cards/print?studentId=${s.id}`}
                filename={`id-card-${s.admissionNo}.pdf`}
                label="ID card"
                variant="ghost"
                tip="A printable card with this student's photo and class"
              />
            </div>
          )}
        </div>
      </div>

      {/*
        Rendered whatever the status. Hiding this once a student left was what made an exit
        one-way: the record showed "withdrawn" and offered nothing, so a mistake had no route
        back through the product at all.
      */}
      {canEditLifecycle && (
        <div className="no-print mt-6 rise rise-2">
          <StudentLifecycle
            studentId={s.id}
            name={`${s.firstName} ${s.lastName}`}
            status={s.status}
          />
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_1.3fr] gap-6 mt-8">
        <div className="space-y-6">
          <StudentGuardians studentId={s.id} guardians={s.guardians} />

          <StudentFiles studentId={s.id} hasPhoto={!!s.photoUrl} />

          <StudentChecklist studentId={s.id} />

          <StudentCustomFields studentId={s.id} />

          <PickupList studentId={s.id} />

          <StudentExtras studentId={s.id} />

          {/* Both take a balance, so both belong behind the same gate as the card above. */}
          {balance !== undefined && (
            <>
              <StudentConcessions
                studentId={s.id}
                studentName={s.firstName}
                balance={balance}
                canManage={canAwardConcessions}
                currency={me.school.currency}
              />

              <InstallmentPlan studentId={s.id} balance={balance} canEdit={canPlan} />
            </>
          )}

          {/* `students.medical` is the nurse's, not everyone's — absent means omit the section. */}
          {s.medicalNotes !== undefined && <MedicalNotes studentId={s.id} notes={s.medicalNotes} />}

          {canEditStudent && (
            <StudentPortalAccess
              studentId={s.id}
              studentName={s.firstName}
              admissionNo={s.admissionNo}
              hasPin={s.hasPortalPin}
            />
          )}

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

        <div className="space-y-6">
          <CumulativeRecord studentId={s.id} />

          {/* Ledger */}
          {mayReadFees && ledger !== undefined && (
            <section className="card p-6 rise rise-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-xl">Fee ledger</h2>
                <GrantConcession studentId={s.id} studentName={s.firstName} />
              </div>
              <p className="text-xs text-oat mt-1">
                Every charge and payment, newest first. Corrections appear as reversals.
              </p>
              <table className="w-full text-sm mt-4 table-stack">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist">
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium">Entry</th>
                    <th className="py-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((e) => (
                    <tr key={e.id} className="border-b border-mist/50 last:border-0">
                      <td
                        data-label="Date"
                        className="py-2.5 text-oat tabular whitespace-nowrap align-top"
                      >
                        {fmtDate(e.createdAt)}
                      </td>
                      <td data-label="Entry" className="py-2.5">
                        <p
                          className={`font-medium text-[13px] ${e.reversed ? 'line-through text-oat' : ''}`}
                        >
                          {LEDGER_LABEL(e.type, e.method)}
                        </p>
                        <p className="text-[11px] text-oat tabular">
                          {e.reference}
                          {e.receiptNumber && ` · ${e.receiptNumber}`}
                        </p>
                        {/* The reason a correction was made matters more than the correction. */}
                        {e.type === 'REVERSAL' && e.note && (
                          <p className="text-[11px] text-oat italic">{e.note}</p>
                        )}
                        {e.reversed && (
                          <p className="text-[11px] text-danger">Reversed — no longer counted</p>
                        )}
                        <span className="flex items-center gap-3">
                          {e.type === 'PAYMENT' && e.receiptNumber && !e.reversed && (
                            <a
                              href={`/api/proxy/fees/receipts/${e.reference}/pdf`}
                              className="no-print text-[11px] text-brand hover:underline underline-offset-2"
                            >
                              Download receipt ↓
                            </a>
                          )}
                          {/* Append-only: a mistake is cancelled by recording that it was. */}
                          {canReverse && !e.reversed && e.type !== 'REVERSAL' && (
                            <ReverseEntry
                              entryId={e.id}
                              label={LEDGER_LABEL(e.type, e.method)}
                              amount={money(e.amount)}
                            />
                          )}
                        </span>
                      </td>
                      <td
                        data-label="Amount"
                        className={`py-2.5 text-right tabular font-medium align-top ${
                          e.reversed
                            ? 'line-through text-oat'
                            : e.type === 'INVOICE'
                              ? 'text-ink'
                              : 'text-leaf'
                        }`}
                      >
                        {e.type === 'INVOICE' ? '' : '−'}
                        {money(e.amount)}
                      </td>
                    </tr>
                  ))}
                  {ledger.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-oat">
                        No ledger entries yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
