/**
 * Server-side PDF builders (pdfkit). Offline/standalone-safe: uses only the built-in
 * Helvetica standard fonts, no external assets. Each builder resolves to a Buffer so it can
 * be streamed via NestJS StreamableFile and passed through the web proxy unchanged.
 */
import PDFDocument from 'pdfkit';

type Doc = PDFKit.PDFDocument;

const INK = '#1c1917';
const OAT = '#78716c';
const MIST = '#d6d3d1';
/** Fallback when a school has not chosen a colour. */
const FOREST = '#166534';

/** The school's own details as they appear on a printed document. */
export interface DocSchool {
  name: string;
  motto: string | null;
  address: string | null;
  phone: string | null;
  /** Validated 6-digit hex, or null to use the house colour. */
  brandColor?: string | null;
  /** Crest bytes, when one is on file. */
  logo?: Buffer | null;
}

const brandOf = (s: DocSchool) => s.brandColor || FOREST;

/**
 * Draw the school crest, or quietly skip it.
 *
 * pdfkit decodes JPEG and PNG only, while the upload endpoint also accepts WebP — so an
 * undrawable crest must never take the whole document down with it. A report card without a
 * logo is a cosmetic loss; a report card that fails to render is a broken term.
 */
function drawCrest(doc: Doc, school: DocSchool, x: number, y: number, size: number): boolean {
  if (!school.logo) return false;
  try {
    doc.image(school.logo, x, y, { fit: [size, size] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Set a font size at which `text` fits on one line, shrinking then truncating.
 *
 * pdfkit's own `lineBreak: false` / `ellipsis` did not hold here — a long school name still
 * wrapped, and on a card laid out at fixed coordinates the second line lands on top of whatever
 * is below it. Measuring is the only reliable way. Leaves the doc at the chosen size, so the
 * caller draws immediately after.
 */
function fitOneLine(doc: Doc, text: string, maxWidth: number, from: number, min: number): string {
  let size = from;
  doc.fontSize(size);
  while (size > min && doc.widthOfString(text) > maxWidth) {
    size -= 0.5;
    doc.fontSize(size);
  }
  if (doc.widthOfString(text) <= maxWidth) return text;
  // Still too wide even at the floor: keep it legible and lose the tail instead.
  let cut = text;
  while (cut.length > 1 && doc.widthOfString(`${cut}…`) > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function toBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

interface Column {
  header: string;
  width: number;
  align?: 'left' | 'center' | 'right';
}

interface TableStyle {
  /** GES uses ruled boxes; MODERN uses zebra striping with only a header rule. */
  zebra?: boolean;
}

/** Draw a table starting at the current y; returns the y after the table. */
function drawTable(
  doc: Doc,
  x0: number,
  columns: Column[],
  rows: string[][],
  style: TableStyle = {},
): number {
  const pad = 5;
  const totalWidth = columns.reduce((a, c) => a + c.width, 0);

  const rowHeight = (cells: string[], bold: boolean) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    let h = 14;
    cells.forEach((cell, i) => {
      const ch = doc.heightOfString(cell ?? '', { width: columns[i].width - pad * 2 });
      h = Math.max(h, ch + 8);
    });
    return h;
  };

  const drawRow = (cells: string[], y: number, bold: boolean, fill?: string) => {
    const h = rowHeight(cells, bold);
    if (fill) doc.rect(x0, y, totalWidth, h).fill(fill);
    let x = x0;
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9)
      .fillColor(INK);
    columns.forEach((col, i) => {
      if (!style.zebra) {
        doc.rect(x, y, col.width, h).strokeColor(MIST).lineWidth(0.5).stroke();
      }
      doc.text(cells[i] ?? '', x + pad, y + 4, {
        width: col.width - pad * 2,
        align: col.align ?? 'left',
      });
      x += col.width;
    });
    if (style.zebra && bold) {
      // A single rule under the header replaces the ruled grid.
      doc
        .moveTo(x0, y + h)
        .lineTo(x0 + totalWidth, y + h)
        .strokeColor(MIST)
        .lineWidth(1)
        .stroke();
    }
    return y + h;
  };

  const headerFill = style.zebra ? undefined : '#f5f5f4';
  let y = drawRow(
    columns.map((c) => c.header),
    doc.y,
    true,
    headerFill,
  );
  rows.forEach((row, i) => {
    if (y > doc.page.height - 120) {
      doc.addPage();
      y = drawRow(
        columns.map((c) => c.header),
        doc.page.margins.top,
        true,
        headerFill,
      );
    }
    y = drawRow(row, y, false, style.zebra && i % 2 === 1 ? '#fafaf9' : undefined);
  });
  doc.y = y;
  return y;
}

const fmtDate = (d?: string | Date | null) =>
  d
    ? new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

export interface ReportCardData {
  schemeKind: 'GES_CLASSIC' | 'NACCA_BANDS' | 'EARLY_YEARS';
  /**
   * The school's own split, for the column headers.
   *
   * These were printed as a fixed "Class (30%) / Exam (70%)" while the weighting is per-school
   * configurable — so a school on 40/60 handed parents a report card whose headings contradicted
   * its own marks. Defaults keep the GES convention for callers that do not pass them.
   */
  weights?: { sba: number; exam: number };
  /** Layout choice (docs/02 §2.3). GES is the statutory-looking default. */
  template?: 'GES' | 'MODERN';
  school: DocSchool;
  student: { name: string; admissionNo: string; className: string | null };
  term: { name?: string; year?: string; nextTermBegins: string | null };
  lines: Array<{
    subject: string;
    sba30: number;
    exam70: number;
    total: number;
    grade: string;
    remark: string;
    position: number | null;
  }>;
  overallTotal: number;
  classPosition: number | null;
  classSize: number | null;
  attendance: { present: number; total: number };
  conduct?: string | null;
  interest?: string | null;
  teacherRemark: string | null;
  headRemark: string | null;
}

export function reportCardPdf(card: ReportCardData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const earlyYears = card.schemeKind === 'EARLY_YEARS';
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  const modern = card.template === 'MODERN';

  const BRAND = brandOf(card.school);

  if (modern) {
    // Modern: a solid masthead with the school reversed out of its own colour.
    const bandH = 74;
    doc.rect(0, 0, doc.page.width, bandH).fill(BRAND);
    const crest = drawCrest(doc, card.school, left, 13, 48);
    const textX = crest ? left + 60 : left;
    const textW = width - (crest ? 60 : 0);
    doc
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(19)
      .text(card.school.name, textX, 18, { width: textW, align: 'left' });
    doc
      .fillColor('#ffffff')
      .opacity(0.85)
      .font('Helvetica')
      .fontSize(9)
      .text(
        [card.school.motto, card.school.address, card.school.phone].filter(Boolean).join('  ·  '),
        textX,
        44,
        { width: textW },
      );
    doc.opacity(1);
    doc.y = bandH + 16;
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(`Terminal Report — ${card.term.name ?? ''}, ${card.term.year ?? ''}`, left, doc.y, {
        width,
      });
    doc.moveDown(0.8);
  } else {
    // GES: centred masthead over a rule, as the statutory form is laid out.
    if (drawCrest(doc, card.school, left + width / 2 - 22, doc.y, 44)) doc.y += 50;
    doc
      .fillColor(BRAND)
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(card.school.name, left, doc.y, { width, align: 'center' });
    doc.fillColor(OAT).font('Helvetica-Oblique').fontSize(9);
    if (card.school.motto) doc.text(card.school.motto, { align: 'center' });
    doc
      .font('Helvetica')
      .text([card.school.address, card.school.phone].filter(Boolean).join(' · '), {
        align: 'center',
      });
    doc
      .moveDown(0.6)
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(`TERMINAL REPORT — ${card.term.name ?? ''}, ${card.term.year ?? ''}`, {
        align: 'center',
      });
    doc
      .moveTo(left, doc.y + 4)
      .lineTo(left + width, doc.y + 4)
      .strokeColor(INK)
      .lineWidth(1)
      .stroke();
    doc.moveDown(1);
  }

  // Student info grid (two columns)
  const info: Array<[string, string]> = [
    ['Name of Pupil', card.student.name],
    ['Admission No.', card.student.admissionNo],
    ['Class', card.student.className ?? '—'],
    ['Attendance', `${card.attendance.present} of ${card.attendance.total} days`],
  ];
  if (!earlyYears) {
    info.push([
      'Position in Class',
      card.classPosition ? `${ordinal(card.classPosition)} of ${card.classSize}` : '—',
    ]);
  }
  info.push(['Next Term Begins', fmtDate(card.term.nextTermBegins)]);

  const infoTop = doc.y;
  const colW = width / 2;
  doc.fontSize(9.5);
  info.forEach(([k, v], i) => {
    const cx = left + (i % 2) * colW;
    const cy = infoTop + Math.floor(i / 2) * 18;
    doc.fillColor(OAT).font('Helvetica').text(`${k}: `, cx, cy, { continued: true });
    doc.fillColor(INK).font('Helvetica-Bold').text(v);
  });
  doc.y = infoTop + Math.ceil(info.length / 2) * 18 + 8;

  // Subjects table
  const columns: Column[] = earlyYears
    ? [
        { header: 'Learning Area', width: width * 0.3 },
        { header: 'Assessment', width: width * 0.18, align: 'center' },
        { header: 'Proficiency', width: width * 0.22, align: 'center' },
        { header: 'Remark', width: width * 0.3 },
      ]
    : [
        { header: 'Subject', width: width * 0.26 },
        { header: `Class (${card.weights?.sba ?? 30}%)`, width: width * 0.12, align: 'center' },
        { header: `Exam (${card.weights?.exam ?? 70}%)`, width: width * 0.12, align: 'center' },
        { header: 'Total', width: width * 0.1, align: 'center' },
        { header: 'Grade', width: width * 0.1, align: 'center' },
        { header: 'Pos.', width: width * 0.08, align: 'center' },
        { header: 'Remark', width: width * 0.22 },
      ];

  const rows = card.lines.map((l) =>
    earlyYears
      ? [l.subject, `${Math.round(l.total)}%`, l.grade, l.remark]
      : [
          l.subject,
          l.sba30.toFixed(1),
          l.exam70.toFixed(1),
          l.total.toFixed(1),
          l.grade,
          l.position ? ordinal(l.position) : '—',
          l.remark,
        ],
  );
  drawTable(doc, left, columns, rows, { zebra: modern });

  if (!earlyYears) {
    doc.moveDown(0.3);
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(INK)
      .text(`Overall Total: ${card.overallTotal.toFixed(1)}`, { align: 'right' });
  }

  // Remarks
  doc.moveDown(1);
  // Always anchor at the left margin: the two-column conduct/interest block above leaves
  // pdfkit's cursor in the right-hand column, which would indent every following line.
  const remark = (label: string, value: string | null) => {
    doc.fillColor(OAT).font('Helvetica').fontSize(8).text(label.toUpperCase(), left, doc.y);
    doc
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(10)
      .text(value || ' ', left, doc.y, { width });
    doc.moveDown(0.6);
  };
  if (card.conduct || card.interest) {
    const y = doc.y;
    doc.fillColor(OAT).font('Helvetica').fontSize(8).text('CONDUCT', left, y);
    doc
      .fillColor(INK)
      .fontSize(10)
      .text(card.conduct || ' ', left, doc.y, { width: width / 2 - 10 });
    const afterConduct = doc.y;
    doc
      .fillColor(OAT)
      .fontSize(8)
      .text('INTEREST', left + width / 2, y);
    doc
      .fillColor(INK)
      .fontSize(10)
      .text(card.interest || ' ', left + width / 2, y + 12, { width: width / 2 - 10 });
    doc.y = Math.max(afterConduct, doc.y);
    doc.x = left;
    doc.moveDown(0.6);
  }
  remark("Class Teacher's Remark", card.teacherRemark);
  remark("Head Teacher's Remark", card.headRemark);

  // Footer
  doc.moveDown(1);
  doc
    .fillColor(OAT)
    .font('Helvetica')
    .fontSize(8)
    .text('Generated by EYO School Management', left, doc.page.height - 60);

  return toBuffer(doc);
}

export interface ReceiptData {
  school: DocSchool;
  receiptNumber: string;
  reference: string;
  issuedAt: string | Date;
  student: { name: string; admissionNo: string; className: string | null };
  /** Student photo bytes, when one is on file (docs/02 §2.4 "receipts with student photo"). */
  studentPhoto?: Buffer | null;
  amount: number;
  method: string | null;
  currency: string;
  note: string | null;
  balanceAfter: number;
}

export function receiptPdf(r: ReceiptData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A5', layout: 'landscape', margin: 36 });
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const money = (n: number) =>
    `${r.currency} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const BRAND = brandOf(r.school);
  if (drawCrest(doc, r.school, left + width / 2 - 16, doc.y, 32)) doc.y += 36;
  doc
    .fillColor(BRAND)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(r.school.name, left, doc.y, { width, align: 'center' });
  doc
    .fillColor(OAT)
    .font('Helvetica')
    .fontSize(8)
    .text([r.school.address, r.school.phone].filter(Boolean).join(' · '), { align: 'center' });
  doc
    .moveDown(0.5)
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('OFFICIAL PAYMENT RECEIPT', { align: 'center' });

  // Student photo, if one is on file — makes a printed receipt hard to reuse for another child.
  if (r.studentPhoto?.length) {
    try {
      doc.image(
        r.studentPhoto,
        doc.page.width - doc.page.margins.right - 56,
        doc.page.margins.top,
        {
          fit: [52, 52],
        },
      );
    } catch {
      // An unreadable or unsupported image must never block issuing a receipt.
    }
  }
  doc
    .moveTo(left, doc.y + 4)
    .lineTo(left + width, doc.y + 4)
    .strokeColor(MIST)
    .lineWidth(1)
    .stroke();
  doc.moveDown(1);

  const row = (k: string, v: string) => {
    doc.fillColor(OAT).font('Helvetica').fontSize(10).text(`${k}: `, { continued: true });
    doc.fillColor(INK).font('Helvetica-Bold').text(v);
    doc.moveDown(0.3);
  };
  row('Receipt No.', r.receiptNumber);
  row('Reference', r.reference);
  row('Date', fmtDate(r.issuedAt));
  row(
    'Received from',
    `${r.student.name} (${r.student.admissionNo}${r.student.className ? ` · ${r.student.className}` : ''})`,
  );
  row('Payment method', r.method ?? '—');
  if (r.note) row('Note', r.note);

  doc.moveDown(0.5);
  doc.rect(left, doc.y, width, 34).fill('#f0fdf4');
  doc
    .fillColor(BRAND)
    .font('Helvetica-Bold')
    .fontSize(15)
    .text(`Amount Paid: ${money(r.amount)}`, left + 10, doc.y - 26, { width: width - 20 });
  doc.moveDown(1);
  doc
    .fillColor(OAT)
    .font('Helvetica')
    .fontSize(9)
    .text(`Balance after payment: ${money(r.balanceAfter)}`);

  doc
    .fillColor(OAT)
    .fontSize(8)
    .text('Thank you. Generated by EYO School Management', left, doc.page.height - 52, {
      align: 'center',
      width,
    });

  return toBuffer(doc);
}

export interface BroadsheetData {
  schoolName: string;
  className: string;
  termName?: string;
  earlyYears: boolean;
  subjects: { id: string; name: string; code: string }[];
  rows: Array<{
    admissionNo: string;
    name: string;
    cells: Array<{ total: number | null }>;
    overallTotal: number;
    position: number | null;
  }>;
  /** School colour, so an internal printout matches the school's other documents. */
  brandColor?: string | null;
}

export function broadsheetPdf(data: BroadsheetData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  doc
    .fillColor(data.brandColor || FOREST)
    .font('Helvetica-Bold')
    .fontSize(15)
    .text(data.schoolName, { align: 'center' });
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(`Broadsheet — ${data.className}${data.termName ? ` · ${data.termName}` : ''}`, {
      align: 'center',
    });
  doc.moveDown(0.6);

  const fixed = data.earlyYears
    ? [
        { header: 'Adm. No.', width: 70 },
        { header: 'Name', width: 150 },
      ]
    : [
        { header: 'Adm. No.', width: 60 },
        { header: 'Name', width: 130 },
        { header: 'Total', width: 40, align: 'center' as const },
        { header: 'Pos.', width: 34, align: 'center' as const },
      ];
  const fixedWidth = fixed.reduce((a, c) => a + c.width, 0);
  const subjW = Math.max(24, (width - fixedWidth) / Math.max(1, data.subjects.length));
  const columns: Column[] = [
    ...fixed,
    ...data.subjects.map((s) => ({ header: s.code, width: subjW, align: 'center' as const })),
  ];
  const cellVal = (t: number | null) =>
    t == null ? '—' : data.earlyYears ? `${Math.round(t)}` : t.toFixed(0);
  const rows = data.rows.map((r) =>
    data.earlyYears
      ? [r.admissionNo, r.name, ...r.cells.map((c) => cellVal(c.total))]
      : [
          r.admissionNo,
          r.name,
          r.overallTotal.toFixed(0),
          r.position ? String(r.position) : '—',
          ...r.cells.map((c) => cellVal(c.total)),
        ],
  );
  drawTable(doc, left, columns, rows);

  doc.moveDown(0.5).fillColor(OAT).font('Helvetica').fontSize(7);
  doc.text('Subject codes: ' + data.subjects.map((s) => `${s.code} = ${s.name}`).join('  ·  '), {
    width,
  });
  return toBuffer(doc);
}

// ── Admission letter ─────────────────────────────────────────────────

export interface AdmissionLetterData {
  school: DocSchool;
  /** The applicant's own reference (APP-2026-0007), quoted back to the parent. */
  reference: string;
  applicant: { name: string; levelName: string | null };
  guardian: { name: string };
  /**
   * OFFERED still reads as an offer that may lapse; ACCEPTED and ENROLLED read as a
   * confirmation. Same letter, different promise — so the wording follows the pipeline.
   */
  stage: 'OFFERED' | 'ACCEPTED' | 'ENROLLED';
  issuedAt: string | Date;
  /** When the child is expected to report, when the school has set a next-term date. */
  resumptionDate?: string | Date | null;
  /** Admission number — only exists once the applicant has become a student. */
  admissionNo?: string | null;
  /** Who signs it, e.g. the head teacher. */
  signatory: string;
}

/**
 * The letter a parent is handed (or emailed) once a place is offered.
 *
 * A single page on purpose: it gets printed, signed and carried to the school gate, and the
 * reference is the only thing the office needs to find the application again.
 */
export function admissionLetterPdf(data: AdmissionLetterData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const BRAND = brandOf(data.school);
  const confirmed = data.stage !== 'OFFERED';

  // Masthead — crest centred over the school's own details, as school letterhead is set.
  if (drawCrest(doc, data.school, left + width / 2 - 24, doc.y, 48)) doc.y += 56;
  doc
    .fillColor(BRAND)
    .font('Helvetica-Bold')
    .fontSize(20)
    .text(data.school.name, left, doc.y, { width, align: 'center' });
  doc.fillColor(OAT).font('Helvetica-Oblique').fontSize(9);
  if (data.school.motto) doc.text(data.school.motto, { align: 'center' });
  doc.font('Helvetica').text([data.school.address, data.school.phone].filter(Boolean).join(' · '), {
    align: 'center',
  });
  doc
    .moveTo(left, doc.y + 6)
    .lineTo(left + width, doc.y + 6)
    .strokeColor(BRAND)
    .lineWidth(1.5)
    .stroke();
  doc.moveDown(1.4);

  // Reference and date sit on one line, the way a letter is filed.
  const refY = doc.y;
  doc.fillColor(OAT).font('Helvetica').fontSize(9).text(`Our Ref: ${data.reference}`, left, refY);
  doc.text(fmtDate(data.issuedAt), left, refY, { width, align: 'right' });
  doc.moveDown(1.2);

  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(confirmed ? 'CONFIRMATION OF ADMISSION' : 'OFFER OF ADMISSION', left, doc.y, {
      width,
      align: 'center',
    });
  doc.moveDown(1.2);

  doc.fillColor(INK).font('Helvetica').fontSize(10.5);
  doc.text(`Dear ${data.guardian.name},`, left, doc.y, { width });
  doc.moveDown(0.8);

  const place = data.applicant.levelName ? ` into ${data.applicant.levelName}` : '';
  doc.text(
    confirmed
      ? `We are pleased to confirm that ${data.applicant.name} has been admitted to ` +
          `${data.school.name}${place}. The admission is now complete and the record is on file.`
      : `We are pleased to offer ${data.applicant.name} a place at ${data.school.name}${place}. ` +
          `The offer is made on the strength of the application and any assessment carried out, ` +
          `and is held open until the date given below.`,
    { width, align: 'justify' },
  );
  doc.moveDown(0.9);

  // Facts block — everything the office and the parent both need to quote.
  const facts: Array<[string, string]> = [
    ['Applicant', data.applicant.name],
    ['Application reference', data.reference],
    ['Class / Level', data.applicant.levelName ?? '—'],
  ];
  if (data.admissionNo) facts.push(['Admission number', data.admissionNo]);
  facts.push([
    confirmed ? 'Reporting date' : 'Offer to be confirmed by',
    fmtDate(data.resumptionDate),
  ]);

  const boxTop = doc.y;
  const boxH = facts.length * 17 + 16;
  doc.rect(left, boxTop, width, boxH).fill('#f5f5f4');
  facts.forEach(([k, v], i) => {
    const y = boxTop + 9 + i * 17;
    doc
      .fillColor(OAT)
      .font('Helvetica')
      .fontSize(9.5)
      .text(`${k}: `, left + 12, y, {
        continued: true,
      });
    doc.fillColor(INK).font('Helvetica-Bold').text(v);
  });
  doc.y = boxTop + boxH;
  doc.x = left;
  doc.moveDown(1);

  doc.fillColor(INK).font('Helvetica').fontSize(10.5);
  doc.text(
    confirmed
      ? 'Please keep this letter safe. Bring it with you on the first day, together with the ' +
          "child's birth certificate and any records from a previous school."
      : 'To take up the place, please report to the school office with this letter, the ' +
          "child's birth certificate and any records from a previous school. Quote the " +
          'reference above in any correspondence.',
    left,
    doc.y,
    { width, align: 'justify' },
  );
  doc.moveDown(1.4);
  doc.text('Yours faithfully,', left, doc.y, { width });

  // Signature rule, left where a pen can reach it.
  doc.moveDown(2.6);
  const sigY = doc.y;
  doc
    .moveTo(left, sigY)
    .lineTo(left + 200, sigY)
    .strokeColor(MIST)
    .lineWidth(0.8)
    .stroke();
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(data.signatory, left, sigY + 5);
  doc
    .fillColor(OAT)
    .font('Helvetica')
    .fontSize(8.5)
    .text('for ' + data.school.name, left, doc.y);

  doc
    .fillColor(OAT)
    .font('Helvetica')
    .fontSize(8)
    .text('Generated by EYO School Management', left, doc.page.height - 60, { width });

  return toBuffer(doc);
}

// ── Gate pass ────────────────────────────────────────────────────────

export interface PickupCardData {
  school: DocSchool;
  holder: string;
  children: string[];
  token: string;
  pin: string;
}

/**
 * A wallet-sized pass carrying the QR and the PIN.
 *
 * This is the "printed card path for guardians without a smartphone" from docs/02 §2.5: the
 * gate scans the QR, and if the card is left at home the PIN still identifies the holder.
 */
export async function pickupCardPdf(data: PickupCardData): Promise<Buffer> {
  const qrcode = await import('qrcode');
  const qr = await qrcode.toBuffer(data.token, { type: 'png', width: 320, margin: 1 });

  // A6 landscape — near enough a large luggage tag, and four fit on an A4 sheet.
  const doc = new PDFDocument({ size: [420, 298], margin: 22 });
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const BRAND = brandOf(data.school);

  doc.rect(0, 0, doc.page.width, 8).fill(BRAND);

  // Crest beside the name, so the pass identifies the school at a glance to someone who cannot
  // read the wordmark. The header is then indented past it; without a crest it sits flush left.
  const CREST = 32;
  const headX = drawCrest(doc, data.school, left, 18, CREST) ? left + CREST + 8 : left;
  const headW = width - (headX - left);
  // One line, always: a long school name that wrapped would land on top of the QR block below.
  doc.fillColor(BRAND).font('Helvetica-Bold');
  const schoolName = fitOneLine(doc, data.school.name, headW, 13, 8);
  doc.text(schoolName, headX, 24, { width: headW, lineBreak: false });
  doc
    .fillColor(OAT)
    .font('Helvetica')
    .fontSize(7.5)
    .text('GATE PASS — present this at the gate', { width: headW });

  doc.image(qr, left, 58, { fit: [104, 104] });

  const infoX = left + 120;
  const infoW = width - 120;
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(data.holder, infoX, 62, { width: infoW });
  doc
    .fillColor(OAT)
    .font('Helvetica')
    .fontSize(8)
    .text('AUTHORISED TO COLLECT', infoX, doc.y + 2, { width: infoW });
  doc
    .fillColor(INK)
    .fontSize(9)
    .text(data.children.join(', '), infoX, doc.y + 1, { width: infoW });

  doc.rect(infoX, 128, infoW, 34).fill('#f5f5f4');
  doc
    .fillColor(OAT)
    .font('Helvetica')
    .fontSize(7.5)
    .text('PIN (if the pass is not to hand)', infoX + 8, 134);
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(17)
    .text(data.pin.replace(/(\d{3})(\d{3})/, '$1 $2'), infoX + 8, 143);

  doc
    .fillColor(OAT)
    .font('Helvetica')
    .fontSize(7)
    .text(
      'Keep this pass safe and do not share the PIN. Report a lost pass to the school at once — it will be cancelled and a new one issued.',
      left,
      182,
      { width },
    );

  // Where to return it, and who to ring. Both are optional on a school record, so a school that
  // has filled in neither simply gets no line rather than a stray separator. Flows from the text
  // above rather than a fixed y, so a two-line address cannot land on top of it.
  const contact = [data.school.address, data.school.phone].filter(Boolean).join(' · ');
  if (contact) {
    doc
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(7.5)
      .text(contact, left, doc.y + 6, { width });
  }
  return toBuffer(doc);
}

export interface StudentIdCardData {
  school: DocSchool;
  name: string;
  admissionNo: string;
  className: string | null;
  /** JPEG or PNG bytes. pdfkit cannot read WebP, so callers must convert or omit. */
  photo?: Buffer;
  /** Encodes the admission number; the gate scanner resolves it like any other pickup code. */
  qrValue: string;
  /** Printed small on the back edge so a found card can be returned. */
  contact?: string | null;
}

/**
 * A student ID card, credit-card sized.
 *
 * The QR carries the admission number rather than a secret. An ID card is worn all day, left in
 * bags and dropped in playgrounds — treating it as a credential would mean a lost card could
 * collect a child. Verification at the gate still goes through the guardian's own QR or PIN;
 * this one identifies, it does not authorise. That distinction is the whole design.
 */

export async function studentIdCardPdf(data: StudentIdCardData): Promise<Buffer> {
  return studentIdCardSheet([data]);
}

/**
 * One document, one card per page.
 *
 * The first version built every card in a batch and then returned only the first, so asking to
 * print a class silently printed one child. Card printers feed page by page, so a multi-page
 * document is both correct and what the hardware wants.
 */
export async function studentIdCardSheet(cards: StudentIdCardData[]): Promise<Buffer> {
  const qrcode = await import('qrcode');
  if (cards.length === 0) throw new Error('No cards to print');

  // CR80 at 72dpi — the size every card printer and lanyard holder expects.
  const doc = new PDFDocument({ size: [243, 153], margin: 12, autoFirstPage: false });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );

  for (const data of cards) {
    const qr = await qrcode.toBuffer(data.qrValue, { type: 'png', width: 240, margin: 1 });
    const BRAND = brandOf(data.school);
    doc.addPage({ size: [243, 153], margin: 12 });

    doc.rect(0, 0, doc.page.width, 26).fill(BRAND);
    doc
      .fillColor('#ffffff')
      .fontSize(9)
      .font('Helvetica-Bold')
      .text(data.school.name.toUpperCase().slice(0, 34), 12, 9, { width: 219 });

    const top = 36;
    if (data.photo) {
      try {
        doc.image(data.photo, 12, top, { fit: [56, 68], align: 'center' });
      } catch {
        // A corrupt or unsupported image must not cost the school its whole print run.
        doc.rect(12, top, 56, 68).fillAndStroke('#f3f0e8', '#ded8c9');
      }
    } else {
      doc.rect(12, top, 56, 68).fillAndStroke('#f3f0e8', '#ded8c9');
    }

    const textX = 78;
    doc
      .fillColor('#1b2822')
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(data.name, textX, top + 2, { width: 100 });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#6b6455')
      .text(data.className ?? '—', textX, top + 20, { width: 100 })
      .text(data.admissionNo, textX, top + 32, { width: 100 });

    doc.image(qr, 181, top + 2, { fit: [50, 50] });

    doc
      .fontSize(5.5)
      .fillColor('#6b6455')
      .text(
        data.contact
          ? `If found, please return to ${data.school.name} · ${data.contact}`
          : `If found, please return to ${data.school.name}`,
        12,
        doc.page.height - 20,
        { width: 219, align: 'center' },
      );
  }

  doc.end();
  return done;
}
