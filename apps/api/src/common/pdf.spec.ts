import { describe, expect, it } from 'vitest';
import {
  admissionLetterPdf,
  contactLine,
  leaverDocPdf,
  tableReportPdf,
  reportCardPdf,
  receiptPdf,
  broadsheetPdf,
  pickupCardPdf,
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

  describe('table report', () => {
    const school = { name: 'Brighton Academy', motto: null, address: 'Accra', phone: '024' };

    it('renders a financial summary as paper', async () => {
      const buf = await tableReportPdf({
        school,
        title: 'Double-entry journal',
        headers: ['Date', 'Reference', 'Description', 'Account', 'Debit', 'Credit'],
        rows: [['2026-05-01', 'INV-1', 'Term 3 fees — Ama Mensah', 'Fee income', '', 1200]],
        numericColumns: [4, 5],
      });
      expect(isPdf(buf)).toBe(true);
    });

    it('carries the headers onto a second page', async () => {
      // A long journal is the normal case, and a second page of unlabelled columns is unreadable.
      const rows = Array.from({ length: 200 }, (_, i) => [
        '2026-05-01',
        `INV-${i}`,
        'Term 3 fees',
        'Fee income',
        '',
        1200,
      ]);
      const buf = await tableReportPdf({
        school,
        title: 'Double-entry journal',
        headers: ['Date', 'Reference', 'Description', 'Account', 'Debit', 'Credit'],
        rows,
        numericColumns: [4, 5],
      });
      expect(isPdf(buf)).toBe(true);
      // Several pages' worth of content rather than one clipped page.
      expect(buf.length).toBeGreaterThan(5000);
    });

    it('keeps an over-long cell on one line', async () => {
      /*
        pdfkit's `lineBreak: false` does not actually stop it wrapping, and rows here sit a fixed
        15pt apart — so a wrapped description overprints the row below it, silently, and only on
        paper. The cell is measured and cut instead.
      */
      const long = 'Term 3 fees — ' + 'Ama Serwaa Mensah of Basic Five Gold '.repeat(6);
      const buf = await tableReportPdf({
        school,
        title: 'Double-entry journal',
        headers: ['Date', 'Reference', 'Description', 'Account', 'Debit', 'Credit'],
        rows: [['2026-05-01', 'INV-1', long, 'Fee income', '', 1200]],
        numericColumns: [4, 5],
      });
      expect(isPdf(buf)).toBe(true);
    });

    it('renders with no rows at all', async () => {
      // "Nobody owes anything" is a real and welcome result; it must still print.
      const buf = await tableReportPdf({
        school,
        title: 'Outstanding fees',
        headers: ['Admission No.', 'Name', 'Class', 'Guardian Phone', 'Balance'],
        rows: [],
      });
      expect(isPdf(buf)).toBe(true);
    });
  });

  describe('leaver documents', () => {
    const base = {
      school: { name: 'Brighton Academy', motto: 'Knowledge', address: 'Accra', phone: '024' },
      student: {
        name: 'Ama Mensah',
        admissionNo: 'BA-0001',
        className: 'JHS 3',
        dateOfBirth: '2010-05-04',
      },
      enrolledAt: '2019-09-10',
      exitDate: '2026-07-23',
      issuedAt: '2026-07-24',
      signatory: 'Mr Kofi Owusu',
    };

    it('renders a transfer letter addressed to the next headteacher', async () => {
      const buf = await leaverDocPdf({
        ...base,
        kind: 'TRANSFER',
        exitReason: 'Family relocating to Kumasi',
      });
      expect(isPdf(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(500);
    });

    it('renders a testimonial, with the academic summary and conduct on file', async () => {
      const buf = await leaverDocPdf({
        ...base,
        kind: 'TESTIMONIAL',
        academic: {
          termsRecorded: 9,
          cumulativeAverage: 72.4,
          lastTerm: 'Term 3',
          lastPosition: '4 of 31',
        },
        conduct: 'Courteous and dependable; a steadying presence in the class.',
      });
      expect(isPdf(buf)).toBe(true);
    });

    it('renders for a child who has not left yet', async () => {
      // A transfer letter is often written the week before the child actually goes, so a null
      // exit date must not blow up or print "Invalid Date".
      const buf = await leaverDocPdf({
        ...base,
        kind: 'TRANSFER',
        exitDate: null,
        exitReason: null,
      });
      expect(isPdf(buf)).toBe(true);
    });

    it('renders with no academic history at all', async () => {
      // A child who left in their first term has no terminal report; the letter still has to exist.
      const buf = await leaverDocPdf({ ...base, kind: 'TESTIMONIAL', academic: undefined });
      expect(isPdf(buf)).toBe(true);
    });
  });

  describe('gate pass', () => {
    const pass = {
      school: {
        name: 'Brighton Academy',
        motto: null,
        address: 'Adjiringanor Road, East Legon, Accra',
        phone: '+233 24 000 0000',
      },
      holder: 'Priscilla Agyemang',
      children: ['Samuel Agyemang', 'Esi Agyemang'],
      token: 'tok_abc123',
      pin: '637887',
    };

    it('renders with a crest, and without one', async () => {
      const qrcode = await import('qrcode');
      const crest = await qrcode.toBuffer('EYO', { type: 'png', width: 120, margin: 1 });
      expect(isPdf(await pickupCardPdf({ ...pass, school: { ...pass.school, logo: crest } }))).toBe(
        true,
      );
      expect(isPdf(await pickupCardPdf(pass))).toBe(true);
    });

    /**
     * The card is laid out at fixed coordinates, so a school name long enough to wrap used to
     * put a second line straight through the QR block. It is measured and shrunk now; this only
     * catches a throw, but it pins the case that regressed.
     */
    it('survives a very long school name and an unreadable crest', async () => {
      const buf = await pickupCardPdf({
        ...pass,
        school: {
          ...pass.school,
          name: 'Our Lady of Perpetual Succour International Preparatory School',
          logo: Buffer.from('not an image at all'),
        },
      });
      expect(isPdf(buf)).toBe(true);
    });

    it('omits the contact line when a school has neither address nor phone', async () => {
      const buf = await pickupCardPdf({
        ...pass,
        school: { ...pass.school, address: null, phone: null },
      });
      expect(isPdf(buf)).toBe(true);
    });
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

describe('the contact strip', () => {
  const base = { name: 'Brighton Academy', motto: null, address: 'Accra', phone: '0302 000 000' };

  it('prints the WhatsApp number where families will see it', () => {
    // The school used to be told to do this by hand, on a screen they would only look at once it
    // was already working.
    expect(contactLine({ ...base, whatsapp: '+233 24 123 4567' })).toContain(
      'WhatsApp +233 24 123 4567',
    );
  });

  it('says nothing at all when no number is connected', () => {
    // Most schools have not connected WhatsApp; the strip must not grow an empty separator.
    expect(contactLine(base)).toBe('Accra  ·  0302 000 000');
    expect(contactLine({ ...base, whatsapp: null })).toBe('Accra  ·  0302 000 000');
  });

  it('is one function, so a document cannot be forgotten', () => {
    // The report card, the bill and the receipt all draw the same string. Written out per call
    // site, the number would have reached one and missed the others.
    expect(contactLine({ ...base, address: null, phone: null, whatsapp: '024' })).toBe(
      'WhatsApp 024',
    );
  });
});
