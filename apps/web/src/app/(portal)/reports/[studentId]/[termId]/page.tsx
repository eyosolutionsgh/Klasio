import Link from 'next/link';
import { api, getMe } from '@/lib/api';
import PrintButton from '@/components/PrintButton';
import DownloadButton from '@/components/DownloadButton';
import ReportRemarks from '@/components/ReportRemarks';

interface Line {
  subject: string;
  sba30: number;
  exam70: number;
  total: number;
  grade: string;
  remark: string;
  position: number | null;
}
interface Card {
  schemeKind: 'GES_CLASSIC' | 'NACCA_BANDS' | 'EARLY_YEARS';
  schemeName: string;
  school: { name: string; motto: string | null; address: string | null; phone: string | null };
  student: { name: string; admissionNo: string; className: string | null; gender: string };
  term: { name: string; year: string; nextTermBegins: string | null };
  lines: Line[];
  overallTotal: number;
  classPosition: number | null;
  classSize: number | null;
  attendance: { present: number; total: number };
  conduct: string | null;
  interest: string | null;
  teacherRemark: string | null;
  headRemark: string | null;
  publishedAt: string | null;
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

export default async function ReportCardPage({
  params,
}: {
  params: Promise<{ studentId: string; termId: string }>;
}) {
  const { studentId, termId } = await params;
  const [card, me] = await Promise.all([
    api<Card>(`/assessment/reports/${studentId}/${termId}`),
    getMe(),
  ]);
  const earlyYears = card.schemeKind === 'EARLY_YEARS';
  const gradeHeader = card.schemeKind === 'GES_CLASSIC' ? 'Grade' : 'Proficiency';

  return (
    <div>
      <div className="no-print flex items-center justify-between mb-6">
        <Link href="/reports" className="text-[13px] text-oat hover:text-forest transition">
          ← Back to reports
        </Link>
        <div className="flex items-center gap-2">
          <DownloadButton
            path={`/assessment/reports/${studentId}/${termId}/pdf`}
            filename={`report-${card.student.admissionNo}-${termId}.pdf`}
            label="Download PDF"
            variant="ghost"
            tip="Server-generated PDF report card"
          />
          <PrintButton />
        </div>
      </div>

      {/* Print-faithful GES-style terminal report */}
      <div className="print-sheet card max-w-3xl mx-auto p-10 relative overflow-hidden">
        <div className="kente-stripe h-1.5 absolute top-0 left-0 right-0" />

        <header className="text-center border-b-2 border-ink pb-5">
          <h1 className="font-display text-3xl tracking-tight">{card.school.name}</h1>
          {card.school.motto && <p className="text-xs italic text-oat mt-1">{card.school.motto}</p>}
          <p className="text-[11px] text-oat mt-1">
            {card.school.address} · {card.school.phone}
          </p>
          <p className="font-display text-lg mt-4 uppercase tracking-wide">
            Terminal Report — {card.term.name}, {card.term.year}
          </p>
        </header>

        <section className="grid grid-cols-2 gap-x-10 gap-y-1.5 text-sm mt-5">
          <p>
            <span className="text-oat">Name of Pupil:</span>{' '}
            <span className="font-medium">{card.student.name}</span>
          </p>
          <p>
            <span className="text-oat">Admission No.:</span>{' '}
            <span className="font-medium tabular">{card.student.admissionNo}</span>
          </p>
          <p>
            <span className="text-oat">Class:</span>{' '}
            <span className="font-medium">{card.student.className}</span>
          </p>
          {!earlyYears && (
            <p>
              <span className="text-oat">Position in Class:</span>{' '}
              <span className="font-medium tabular">
                {card.classPosition
                  ? `${ordinal(card.classPosition)} out of ${card.classSize}`
                  : '—'}
              </span>
            </p>
          )}
          <p>
            <span className="text-oat">Attendance:</span>{' '}
            <span className="font-medium tabular">
              {card.attendance.present} out of {card.attendance.total} days
            </span>
          </p>
          <p>
            <span className="text-oat">Next Term Begins:</span>{' '}
            <span className="font-medium">
              {card.term.nextTermBegins
                ? new Date(card.term.nextTermBegins).toLocaleDateString('en-GH', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })
                : '—'}
            </span>
          </p>
        </section>

        <table className="w-full text-sm mt-6 border-collapse">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-widest bg-parchment">
              <th className="border border-mist px-3 py-2 text-left font-medium">
                {earlyYears ? 'Learning Area' : 'Subject'}
              </th>
              {!earlyYears && (
                <>
                  <th className="border border-mist px-2 py-2 font-medium">
                    Class Score
                    <span className="block normal-case tracking-normal text-oat">(30%)</span>
                  </th>
                  <th className="border border-mist px-2 py-2 font-medium">
                    Exam Score
                    <span className="block normal-case tracking-normal text-oat">(70%)</span>
                  </th>
                </>
              )}
              <th className="border border-mist px-2 py-2 font-medium">
                {earlyYears ? 'Assessment' : 'Total'}
              </th>
              <th className="border border-mist px-2 py-2 font-medium">{gradeHeader}</th>
              {!earlyYears && (
                <th className="border border-mist px-2 py-2 font-medium">Position</th>
              )}
              <th className="border border-mist px-3 py-2 text-left font-medium">Remark</th>
            </tr>
          </thead>
          <tbody>
            {card.lines.map((l) => (
              <tr key={l.subject}>
                <td className="border border-mist px-3 py-1.5 font-medium">{l.subject}</td>
                {!earlyYears && (
                  <>
                    <td className="border border-mist px-2 py-1.5 text-center tabular">
                      {l.sba30.toFixed(1)}
                    </td>
                    <td className="border border-mist px-2 py-1.5 text-center tabular">
                      {l.exam70.toFixed(1)}
                    </td>
                  </>
                )}
                <td className="border border-mist px-2 py-1.5 text-center tabular font-medium">
                  {earlyYears ? `${l.total.toFixed(0)}%` : l.total.toFixed(1)}
                </td>
                <td className="border border-mist px-2 py-1.5 text-center font-display">
                  {l.grade}
                </td>
                {!earlyYears && (
                  <td className="border border-mist px-2 py-1.5 text-center tabular">
                    {l.position ? ordinal(l.position) : '—'}
                  </td>
                )}
                <td className="border border-mist px-3 py-1.5">{l.remark}</td>
              </tr>
            ))}
          </tbody>
          {!earlyYears && (
            <tfoot>
              <tr className="bg-parchment/60">
                <td className="border border-mist px-3 py-2 font-medium">Overall Total</td>
                <td className="border border-mist" colSpan={2} />
                <td className="border border-mist px-2 py-2 text-center tabular font-display text-base">
                  {card.overallTotal.toFixed(1)}
                </td>
                <td className="border border-mist" colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>

        <section className="mt-6 space-y-4 text-sm">
          {(card.conduct || card.interest) && (
            <div className="grid grid-cols-2 gap-x-10">
              <div>
                <p className="text-[11px] uppercase tracking-widest text-oat">Conduct</p>
                <p className="border-b border-dotted border-oat pb-1 mt-1 min-h-6">
                  {card.conduct ?? ''}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-oat">Interest</p>
                <p className="border-b border-dotted border-oat pb-1 mt-1 min-h-6">
                  {card.interest ?? ''}
                </p>
              </div>
            </div>
          )}
          <div>
            <p className="text-[11px] uppercase tracking-widest text-oat">Class Teacher’s Remark</p>
            <p className="border-b border-dotted border-oat pb-1 mt-1 min-h-6">
              {card.teacherRemark ?? ''}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest text-oat">Head Teacher’s Remark</p>
            <p className="border-b border-dotted border-oat pb-1 mt-1 min-h-6">
              {card.headRemark ?? ''}
            </p>
          </div>
        </section>

        <footer className="mt-8 flex justify-between items-end text-xs text-oat">
          <p>Generated by EYO School Management</p>
          <div className="text-center">
            <div className="border-t border-ink w-40 pt-1">Head Teacher’s Signature</div>
          </div>
        </footer>
      </div>

      <div className="max-w-3xl mx-auto">
        <ReportRemarks
          studentId={studentId}
          termId={termId}
          role={me.user.role}
          published={!!card.publishedAt}
          initial={{
            conduct: card.conduct,
            interest: card.interest,
            teacherRemark: card.teacherRemark,
            headRemark: card.headRemark,
          }}
        />
      </div>
    </div>
  );
}
