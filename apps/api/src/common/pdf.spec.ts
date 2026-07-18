import { describe, expect, it } from 'vitest';
import {
  admissionLetterPdf,
  reportCardPdf,
  receiptPdf,
  broadsheetPdf,
  ReportCardData,
} from './pdf';

const baseCard: ReportCardData = {
  schemeKind: 'GES_CLASSIC',
  school: { name: 'Brighton Academy', motto: 'Knowledge', address: 'Accra', phone: '024' },
  student: { name: 'Ama Mensah', admissionNo: 'BA-0001', className: 'JHS 2' },
  term: { name: 'Term 3', year: '2025/2026', nextTermBegins: '2026-09-14' },
  lines: [
    {
      subject: 'Maths',
      sba30: 25,
      exam70: 60,
      total: 85,
      grade: '1',
      remark: 'Excellent',
      position: 1,
    },
  ],
  overallTotal: 85,
  classPosition: 1,
  classSize: 12,
  attendance: { present: 58, total: 60 },
  teacherRemark: 'Hardworking.',
  headRemark: 'Keep it up.',
};

const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-';

describe('PDF builders', () => {
  it('renders a GES report card as a PDF', async () => {
    const buf = await reportCardPdf(baseCard);
    expect(isPdf(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
  });

  it('renders an early-years report card (no positions)', async () => {
    const buf = await reportCardPdf({
      ...baseCard,
      schemeKind: 'EARLY_YEARS',
      classPosition: null,
      lines: [
        {
          subject: 'Language',
          sba30: 80,
          exam70: 0,
          total: 80,
          grade: 'Exceeding',
          remark: 'Great',
          position: null,
        },
      ],
    });
    expect(isPdf(buf)).toBe(true);
  });

  it('renders a receipt PDF', async () => {
    const buf = await receiptPdf({
      school: { name: 'Brighton', motto: null, address: 'Accra', phone: '024' },
      receiptNumber: 'RCP-1',
      reference: 'PAY-1',
      issuedAt: new Date('2026-07-01'),
      student: { name: 'Ama', admissionNo: 'BA-0001', className: 'JHS 2' },
      amount: 500,
      method: 'MOMO',
      currency: 'GHS',
      note: null,
      balanceAfter: 250,
    });
    expect(isPdf(buf)).toBe(true);
  });

  it('renders an admission letter as an offer', async () => {
    const buf = await admissionLetterPdf({
      school: { name: 'Brighton', motto: 'Knowledge', address: 'Accra', phone: '024' },
      reference: 'APP-2026-0007',
      applicant: { name: 'Kofi Boateng', levelName: 'Class 1' },
      guardian: { name: 'Akosua Boateng' },
      stage: 'OFFERED',
      issuedAt: new Date('2026-07-01'),
      resumptionDate: '2026-09-14',
      signatory: 'Mrs. Adjei',
    });
    expect(isPdf(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
  });

  it('renders an admission letter for an enrolled child, with the admission number', async () => {
    const buf = await admissionLetterPdf({
      school: { name: 'Brighton', motto: null, address: null, phone: null, logo: null },
      reference: 'APP-2026-0008',
      applicant: { name: 'Ama Mensah', levelName: null },
      guardian: { name: 'Yaw Mensah' },
      stage: 'ENROLLED',
      issuedAt: '2026-07-02',
      resumptionDate: null,
      admissionNo: 'BA-0042',
      signatory: 'Mrs. Adjei',
    });
    expect(isPdf(buf)).toBe(true);
  });

  it('renders a broadsheet PDF', async () => {
    const buf = await broadsheetPdf({
      schoolName: 'Brighton',
      className: 'JHS 2',
      termName: 'Term 3',
      earlyYears: false,
      subjects: [{ id: 's1', name: 'Maths', code: 'MATH' }],
      rows: [
        {
          admissionNo: 'BA-0001',
          name: 'Ama',
          cells: [{ total: 85 }],
          overallTotal: 85,
          position: 1,
        },
      ],
    });
    expect(isPdf(buf)).toBe(true);
  });
});
