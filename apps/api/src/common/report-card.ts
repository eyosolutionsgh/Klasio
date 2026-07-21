/**
 * One published report card, assembled once.
 *
 * This existed three times — in the guardian portal, in the pupil portal, and about to be a
 * fourth time for the WhatsApp assistant. They were near-identical, and the near part is the
 * problem: when the guardian copy learned to carry the school's brand colour and weighting, the
 * pupil copy did not, so the same marks printed as "Class (30%)" for one reader and "Class (40%)"
 * for the other. A parent and their child comparing two downloads of the same document is not a
 * hypothetical — it is what happens on results day.
 *
 * The caller decides *whether* the reader may have it (custody, fee clearance, whose child this
 * is). This decides only what the document says.
 */
import { ReportCardData } from './pdf';
import { storage } from './storage';

/** The slice of PrismaService this needs. Structural, so the helper stays easy to reason about. */
export interface ReportCardDb {
  student: { findFirst(args: unknown): Promise<unknown> };
  termReport: { findFirst(args: unknown): Promise<unknown> };
  school: { findUniqueOrThrow(args: unknown): Promise<unknown> };
  term: { findFirst(args: unknown): Promise<unknown> };
  classRoom: { findFirst(args: unknown): Promise<unknown> };
  gradingScheme: { findFirst(args: unknown): Promise<unknown> };
}

interface StudentRow {
  firstName: string;
  lastName: string;
  admissionNo: string;
  classRoom: { name: string } | null;
}

interface ReportRow {
  classId: string;
  lines: unknown;
  overallTotal: number;
  classPosition: number | null;
  classSize: number | null;
  attendancePresent: number;
  attendanceTotal: number;
  conduct: string | null;
  interest: string | null;
  teacherRemark: string | null;
  headRemark: string | null;
}

/**
 * Build the card, or return null when there is no published report for that child and term.
 *
 * Null rather than throwing, because the three callers refuse differently: the portals answer
 * 404, and the assistant says so in a sentence.
 */
export async function buildReportCard(
  db: ReportCardDb,
  schoolId: string,
  studentId: string,
  termId: string,
): Promise<ReportCardData | null> {
  const [student, report] = (await Promise.all([
    db.student.findFirst({
      where: { id: studentId, schoolId },
      include: { classRoom: { select: { name: true } } },
    }),
    db.termReport.findFirst({
      // Published only. A child must never read a report before the school releases it, and this
      // is the single place all three readers pass through.
      where: { studentId, termId, schoolId, publishedAt: { not: null } },
    }),
  ])) as [StudentRow | null, ReportRow | null];
  if (!student || !report) return null;

  const [school, term, level] = (await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: schoolId } }),
    db.term.findFirst({
      where: { id: termId },
      include: { academicYear: { select: { name: true } } },
    }),
    db.classRoom.findFirst({
      where: { id: report.classId },
      include: { level: { include: { gradingScheme: true } } },
    }),
  ])) as [
    {
      name: string;
      motto: string | null;
      address: string | null;
      phone: string | null;
      brandColor: string | null;
      logoUrl: string | null;
      reportTemplate: string;
      sbaWeight: number | null;
      examWeight: number | null;
    },
    { name: string; nextTermBegins: Date | null; academicYear: { name: string } } | null,
    { level: { gradingScheme: { kind: string } | null } } | null,
  ];

  const scheme =
    level?.level.gradingScheme ??
    ((await db.gradingScheme.findFirst({
      where: { schoolId, kind: 'GES_CLASSIC' },
    })) as { kind: string } | null);

  return {
    schemeKind: scheme?.kind ?? 'GES_CLASSIC',
    template: school.reportTemplate,
    school: {
      name: school.name,
      motto: school.motto,
      address: school.address,
      phone: school.phone,
      brandColor: school.brandColor,
      // Bytes, not the storage key — and a crest that cannot be read must not stop anyone getting
      // the report card, so a failed fetch degrades to no logo.
      logo: school.logoUrl
        ? await storage()
            .get(school.logoUrl)
            .catch(() => null)
        : null,
    },
    weights: { sba: school.sbaWeight ?? 30, exam: school.examWeight ?? 70 },
    student: {
      name: `${student.firstName} ${student.lastName}`,
      admissionNo: student.admissionNo,
      className: student.classRoom?.name ?? null,
    },
    term: {
      name: term?.name,
      year: term?.academicYear.name,
      nextTermBegins: term?.nextTermBegins ?? null,
    },
    lines: report.lines,
    overallTotal: report.overallTotal,
    classPosition: report.classPosition,
    classSize: report.classSize,
    attendance: { present: report.attendancePresent, total: report.attendanceTotal },
    conduct: report.conduct,
    interest: report.interest,
    teacherRemark: report.teacherRemark,
    headRemark: report.headRemark,
  } as unknown as ReportCardData;
}
