/*
 * Test fixture: a SECOND tenant, for proving multi-school isolation.
 *
 * Deliberately unlike Brighton Academy in every visible way — different name, brand colour,
 * admission-number format, levels, subjects and surnames — so that any cross-tenant leak shows up
 * on screen rather than having to be reasoned about. Idempotent: wipes and recreates its own
 * school only, and never touches another tenant's rows.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ROLE_PRESETS } from '../src/common/permissions';

const db = new PrismaClient();

const SLUG = 'sunbeam-international';

const GES_BANDS = [
  { min: 80, max: 100, grade: '1', remark: 'Excellent' },
  { min: 70, max: 79, grade: '2', remark: 'Very Good' },
  { min: 60, max: 69, grade: '3', remark: 'Good' },
  { min: 50, max: 59, grade: '4', remark: 'Credit' },
  { min: 40, max: 49, grade: '5', remark: 'Pass' },
  { min: 0, max: 39, grade: '9', remark: 'Fail' },
];

// Surnames that appear in no other tenant, so a leak is unmistakable.
const SUNBEAM_FAMILIES = [
  'Zorkpe',
  'Vandyke',
  'Xatse',
  'Quansah-Bruce',
  'Wuni',
  'Yeboah-Kranti',
  'Nkrumah-Baffoe',
  'Larweh',
];
const SUNBEAM_FIRST = [
  'Selorm',
  'Elikem',
  'Mawuli',
  'Dzifa',
  'Sedinam',
  'Etornam',
  'Kekeli',
  'Senanu',
];

let rngState = 7;
function rng() {
  rngState = (rngState * 1103515245 + 12345) % 2147483648;
  return rngState / 2147483648;
}

async function wipe(sid: string) {
  await db.pickupCredential.deleteMany({ where: { schoolId: sid } });
  await db.pickupDelegate.deleteMany({ where: { schoolId: sid } });
  await db.releaseLog.deleteMany({ where: { schoolId: sid } });
  await db.dismissalRequest.deleteMany({ where: { schoolId: sid } });
  await db.studentFeeItem.deleteMany({ where: { schoolId: sid } });
  await db.studentDocument.deleteMany({ where: { schoolId: sid } });
  await db.bankDeposit.deleteMany({ where: { schoolId: sid } });
  await db.paymentIntent.deleteMany({ where: { schoolId: sid } });
  await db.webhookEvent.deleteMany({ where: { schoolId: sid } });
  await db.gatewayAccount.deleteMany({ where: { schoolId: sid } });
  await db.receipt.deleteMany({ where: { schoolId: sid } });
  await db.ledgerEntry.deleteMany({ where: { schoolId: sid } });
  await db.invoice.deleteMany({ where: { schoolId: sid } });
  await db.user.updateMany({ where: { schoolId: sid }, data: { staffRoleId: null } });
  await db.staffRole.deleteMany({ where: { schoolId: sid } });
  await db.concessionAward.deleteMany({ where: { schoolId: sid } });
  await db.concessionRule.deleteMany({ where: { schoolId: sid } });
  await db.feeItem.deleteMany({ where: { schoolId: sid } });
  await db.termReport.deleteMany({ where: { schoolId: sid } });
  await db.score.deleteMany({ where: { schoolId: sid } });
  await db.assessmentComponent.deleteMany({ where: { schoolId: sid } });
  await db.attendanceRecord.deleteMany({ where: { schoolId: sid } });
  await db.announcement.deleteMany({ where: { schoolId: sid } });
  await db.studentGuardian.deleteMany({ where: { student: { schoolId: sid } } });
  await db.guardianOtp.deleteMany({ where: { schoolId: sid } });
  await db.guardian.deleteMany({ where: { schoolId: sid } });
  await db.student.deleteMany({ where: { schoolId: sid } });
  await db.subject.deleteMany({ where: { schoolId: sid } });
  await db.classRoom.deleteMany({ where: { schoolId: sid } });
  await db.level.deleteMany({ where: { schoolId: sid } });
  await db.gradingScheme.deleteMany({ where: { schoolId: sid } });
  await db.smsMessage.deleteMany({ where: { schoolId: sid } });
  await db.term.deleteMany({ where: { academicYear: { schoolId: sid } } });
  await db.academicYear.deleteMany({ where: { schoolId: sid } });
  await db.auditLog.deleteMany({ where: { schoolId: sid } });
  await db.user.deleteMany({ where: { schoolId: sid } });
  await db.school.delete({ where: { id: sid } });
}

async function main() {
  const existing = await db.school.findUnique({ where: { slug: SLUG } });
  if (existing) await wipe(existing.id);

  const school = await db.school.create({
    data: {
      name: 'Sunbeam International School',
      admissionNoFormat: 'SIS/{####}',
      slug: SLUG,
      motto: 'Light · Truth · Excellence',
      address: 'Spintex Road, Tema, Greater Accra',
      phone: '+233 30 111 2222',
      email: 'klasio-sunbeam@mailinator.com',
      region: 'Greater Accra',
      website: 'www.sunbeam.edu.gh',
      // Deliberately nothing like Brighton's green — a leaked page is visible at a glance.
      brandColor: '#6d28d9',
      // Starts on the free tier so the upgrade path can be exercised from the bottom.
      tier: 'BASIC',
      smsSenderId: 'SUNBEAM',
      smsCredits: 100,
    },
  });
  const sid = school.id;

  const roleByKey = new Map<string, string>();
  for (const preset of ROLE_PRESETS) {
    const created = await db.staffRole.create({
      data: {
        schoolId: sid,
        name: preset.name,
        description: preset.description,
        permissions: [...preset.permissions],
        presetKey: preset.key,
      },
    });
    roleByKey.set(preset.key, created.id);
  }

  const hash = await bcrypt.hash('Password1!', 10);
  const [owner, , , teacher] = await Promise.all([
    db.user.create({
      data: {
        schoolId: sid,
        name: 'Mr. Selorm Zorkpe',
        email: 'klasio-sunbeam-owner@mailinator.com',
        role: 'OWNER',
        passwordHash: hash,
      },
    }),
    db.user.create({
      data: {
        schoolId: sid,
        name: 'Mrs. Dzifa Vandyke',
        email: 'klasio-sunbeam-head@mailinator.com',
        role: 'HEAD',
        staffRoleId: roleByKey.get('HEAD'),
        passwordHash: hash,
      },
    }),
    db.user.create({
      data: {
        schoolId: sid,
        name: 'Mr. Mawuli Xatse',
        email: 'klasio-sunbeam-bursar@mailinator.com',
        role: 'BURSAR',
        staffRoleId: roleByKey.get('BURSAR'),
        passwordHash: hash,
      },
    }),
    db.user.create({
      data: {
        schoolId: sid,
        name: 'Ms. Sedinam Wuni',
        email: 'klasio-sunbeam-teacher@mailinator.com',
        role: 'TEACHER',
        staffRoleId: roleByKey.get('CLASS_TEACHER'),
        passwordHash: hash,
      },
    }),
  ]);

  // A different academic year from Brighton's, so a leaked term is obvious too.
  const year = await db.academicYear.create({
    data: {
      schoolId: sid,
      name: '2025/2026',
      startDate: new Date('2025-09-01'),
      endDate: new Date('2026-07-24'),
      isCurrent: true,
    },
  });
  await db.term.create({
    data: {
      academicYearId: year.id,
      name: 'Michaelmas Term',
      startDate: new Date('2025-09-01'),
      endDate: new Date('2025-12-12'),
      nextTermBegins: new Date('2026-01-05'),
      isCurrent: false,
    },
  });
  await db.term.create({
    data: {
      academicYearId: year.id,
      name: 'Lent Term',
      startDate: new Date('2026-01-05'),
      endDate: new Date('2026-03-27'),
      nextTermBegins: new Date('2026-04-20'),
      isCurrent: false,
    },
  });
  const currentTerm = await db.term.create({
    data: {
      academicYearId: year.id,
      name: 'Trinity Term',
      startDate: new Date('2026-04-20'),
      endDate: new Date('2026-07-24'),
      nextTermBegins: new Date('2026-09-07'),
      isCurrent: true,
    },
  });

  const scheme = await db.gradingScheme.create({
    data: { schoolId: sid, name: 'Sunbeam Scale', kind: 'GES_CLASSIC', bands: GES_BANDS },
  });

  // Sunbeam runs a senior high, which Brighton does not — the level list alone identifies the
  // tenant on screen.
  const levelDefs: Array<[string, 'PRIMARY' | 'JHS' | 'SHS', number]> = [
    ['Grade 5', 'PRIMARY', 1],
    ['Grade 6', 'PRIMARY', 2],
    ['Form 1', 'SHS', 3],
    ['Form 2', 'SHS', 4],
  ];
  const levels = await Promise.all(
    levelDefs.map(([name, category, order]) =>
      db.level.create({
        data: { schoolId: sid, name, category, order, gradingSchemeId: scheme.id },
      }),
    ),
  );
  const classes = await Promise.all(
    levels.map((lv) =>
      db.classRoom.create({
        data: { schoolId: sid, levelId: lv.id, name: lv.name, classTeacherId: teacher.id },
      }),
    ),
  );

  const subjectDefs: Array<[string, string, boolean]> = [
    ['English Language', 'ENG', true],
    ['Core Mathematics', 'CMATH', true],
    ['Physics', 'PHY', false],
    ['Literature in English', 'LIT', false],
    ['French', 'FRE', false],
  ];
  await Promise.all(
    subjectDefs.map(([name, code, isCore]) =>
      db.subject.create({ data: { schoolId: sid, name, code, isCore } }),
    ),
  );

  await Promise.all([
    db.assessmentComponent.create({
      data: { schoolId: sid, name: 'Continuous Assessment', maxScore: 30, order: 1 },
    }),
    db.assessmentComponent.create({
      data: {
        schoolId: sid,
        name: 'Terminal Examination',
        maxScore: 100,
        category: 'EXAM',
        order: 2,
      },
    }),
  ]);

  let seq = 1;
  const students: { id: string }[] = [];
  for (const cls of classes) {
    for (let i = 0; i < 6; i++) {
      const first = SUNBEAM_FIRST[Math.floor(rng() * SUNBEAM_FIRST.length)];
      const last = SUNBEAM_FAMILIES[Math.floor(rng() * SUNBEAM_FAMILIES.length)];
      const male = rng() > 0.5;
      const st = await db.student.create({
        data: {
          schoolId: sid,
          admissionNo: `SIS/${String(seq++).padStart(4, '0')}`,
          firstName: first,
          lastName: last,
          gender: male ? 'MALE' : 'FEMALE',
          dateOfBirth: new Date(
            2010 + Math.floor(rng() * 6),
            Math.floor(rng() * 12),
            1 + Math.floor(rng() * 27),
          ),
          classId: cls.id,
        },
      });
      students.push({ id: st.id });
    }
  }

  // Fees, so the money pages have something tenant-specific to show.
  const tuition = await db.feeItem.create({
    data: {
      schoolId: sid,
      name: 'School Fees (Trinity)',
      amount: 2400,
      termId: currentTerm.id,
      optional: false,
    },
  });
  let inv = 1;
  for (const st of students) {
    await db.invoice.create({
      data: {
        schoolId: sid,
        studentId: st.id,
        termId: currentTerm.id,
        number: `SIS-INV-${String(inv).padStart(4, '0')}`,
        lines: [{ name: tuition.name, amount: 2400 }],
        total: 2400,
      },
    });
    await db.ledgerEntry.create({
      data: {
        schoolId: sid,
        studentId: st.id,
        termId: currentTerm.id,
        type: 'INVOICE',
        amount: 2400,
        reference: `SIS-LED-${String(inv).padStart(4, '0')}`,
        note: tuition.name,
        createdById: owner.id,
      },
    });
    inv++;
  }

  console.log(`Sunbeam International School provisioned: ${sid} (tier ${school.tier})`);
  console.log(
    '  klasio-sunbeam-owner@mailinator.com / klasio-sunbeam-head@mailinator.com / klasio-sunbeam-bursar@mailinator.com — Password1!',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
