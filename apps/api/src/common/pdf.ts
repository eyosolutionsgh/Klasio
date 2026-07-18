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
const FOREST = '#166534';

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

/** Draw a bordered table starting at the current y; returns the y after the table. */
function drawTable(doc: Doc, x0: number, columns: Column[], rows: string[][]): number {
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
      doc.rect(x, y, col.width, h).strokeColor(MIST).lineWidth(0.5).stroke();
      doc.text(cells[i] ?? '', x + pad, y + 4, {
        width: col.width - pad * 2,
        align: col.align ?? 'left',
      });
      x += col.width;
    });
    return y + h;
  };

  let y = drawRow(
    columns.map((c) => c.header),
    doc.y,
    true,
    '#f5f5f4',
  );
  for (const row of rows) {
    if (y > doc.page.height - 120) {
      doc.addPage();
      y = drawRow(
        columns.map((c) => c.header),
        doc.page.margins.top,
        true,
        '#f5f5f4',
      );
    }
    y = drawRow(row, y, false);
  }
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
  school: { name: string; motto: string | null; address: string | null; phone: string | null };
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
  teacherRemark: string | null;
  headRemark: string | null;
}

export function reportCardPdf(card: ReportCardData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const earlyYears = card.schemeKind === 'EARLY_YEARS';
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  // Header
  doc
    .fillColor(FOREST)
    .font('Helvetica-Bold')
    .fontSize(20)
    .text(card.school.name, { align: 'center' });
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
        { header: 'Class (30%)', width: width * 0.12, align: 'center' },
        { header: 'Exam (70%)', width: width * 0.12, align: 'center' },
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
  drawTable(doc, left, columns, rows);

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
  const remark = (label: string, value: string | null) => {
    doc.fillColor(OAT).font('Helvetica').fontSize(8).text(label.toUpperCase());
    doc
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(10)
      .text(value || ' ', { width });
    doc.moveDown(0.6);
  };
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
  school: { name: string; motto: string | null; address: string | null; phone: string | null };
  receiptNumber: string;
  reference: string;
  issuedAt: string | Date;
  student: { name: string; admissionNo: string; className: string | null };
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

  doc
    .fillColor(FOREST)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(r.school.name, { align: 'center' });
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
    .fillColor(FOREST)
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
}

export function broadsheetPdf(data: BroadsheetData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  doc
    .fillColor(FOREST)
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
