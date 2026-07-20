/* Seed: demo Ghanaian private school with full term data. Idempotent (wipes + recreates demo school). */
import { PrismaClient, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROLE_PRESETS } from '../src/common/permissions';
import { objectKey, storage } from '../src/common/storage';

const db = new PrismaClient();

const GES_BANDS = [
  { min: 80, max: 100, grade: '1', remark: 'Excellent' },
  { min: 70, max: 79, grade: '2', remark: 'Very Good' },
  { min: 65, max: 69, grade: '3', remark: 'Good' },
  { min: 60, max: 64, grade: '4', remark: 'Credit' },
  { min: 55, max: 59, grade: '5', remark: 'Credit' },
  { min: 50, max: 54, grade: '6', remark: 'Pass' },
  { min: 45, max: 49, grade: '7', remark: 'Pass' },
  { min: 40, max: 44, grade: '8', remark: 'Weak Pass' },
  { min: 0, max: 39, grade: '9', remark: 'Fail' },
];

// NaCCA proficiency (Standards-Based Curriculum): total → proficiency label.
const NACCA_BANDS = [
  { min: 80, max: 100, grade: 'AE', remark: 'Advanced — exceeding expectation' },
  { min: 68, max: 79, grade: 'P', remark: 'Proficient — meeting expectation' },
  { min: 54, max: 67, grade: 'AP', remark: 'Approaching expectation' },
  { min: 40, max: 53, grade: 'D', remark: 'Developing' },
  { min: 0, max: 39, grade: 'B', remark: 'Beginning' },
];

// Early-years observation scale (creche/nursery/KG): no exam weighting, no positions.
const EARLY_YEARS_BANDS = [
  { min: 75, max: 100, grade: 'Exceeding', remark: 'Consistently demonstrates the skill' },
  { min: 50, max: 74, grade: 'Meeting', remark: 'Demonstrates the skill' },
  { min: 25, max: 49, grade: 'Approaching', remark: 'Developing the skill' },
  { min: 0, max: 24, grade: 'Beginning', remark: 'Beginning to explore the skill' },
];

const FIRST_M = [
  'Kofi',
  'Kwame',
  'Kwesi',
  'Yaw',
  'Kojo',
  'Kwabena',
  'Nana',
  'Emmanuel',
  'Daniel',
  'Michael',
  'Samuel',
  'Joseph',
];
const FIRST_F = [
  'Ama',
  'Akosua',
  'Abena',
  'Adwoa',
  'Afia',
  'Yaa',
  'Esi',
  'Akua',
  'Gifty',
  'Priscilla',
  'Comfort',
  'Abigail',
];
const LAST = [
  'Mensah',
  'Owusu',
  'Boateng',
  'Asante',
  'Osei',
  'Appiah',
  'Agyemang',
  'Addo',
  'Ankrah',
  'Darko',
  'Amoah',
  'Frimpong',
  'Tetteh',
  'Quartey',
];

// deterministic pseudo-random (stable seeds → stable screenshots)
let rngState = 42;
function rng() {
  rngState = (rngState * 1103515245 + 12345) % 2147483648;
  return rngState / 2147483648;
}
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

async function main() {
  console.log('Seeding demo school…');
  const existing = await db.school.findUnique({ where: { slug: 'brighton-academy' } });
  if (existing) {
    const sid = existing.id;
    // wipe in FK-safe order
    // These all reference students/invoices — clear them first.
    // Pickup safety: credentials point at guardians and delegates, so they go first, and the
    // whole set must precede students and guardians below.
    await db.pickupCredential.deleteMany({ where: { schoolId: sid } });
    await db.pickupDelegate.deleteMany({ where: { schoolId: sid } });
    await db.releaseLog.deleteMany({ where: { schoolId: sid } });
    await db.checkInLog.deleteMany({ where: { schoolId: sid } });
    await db.carLineEntry.deleteMany({ where: { schoolId: sid } });
    await db.dismissalRequest.deleteMany({ where: { schoolId: sid } });
    // Optional-fee subscriptions reference both students and fee items.
    await db.studentFeeItem.deleteMany({ where: { schoolId: sid } });
    await db.studentDocument.deleteMany({ where: { schoolId: sid } });
    await db.bankDeposit.deleteMany({ where: { schoolId: sid } });
    await db.paymentIntent.deleteMany({ where: { schoolId: sid } });
    await db.webhookEvent.deleteMany({ where: { schoolId: sid } });
    await db.gatewayAccount.deleteMany({ where: { schoolId: sid } });
    await db.receipt.deleteMany({ where: { schoolId: sid } });
    await db.ledgerEntry.deleteMany({ where: { schoolId: sid } });
    await db.invoice.deleteMany({ where: { schoolId: sid } });
    // Users point at roles, so break the link before the roles go.
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
    // Sign-in codes reference guardians — clear them before the guardians themselves.
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

  const school = await db.school.create({
    data: {
      name: 'Brighton Academy',
      // Match the numbers the seed itself issues below, so enrolling after a reseed continues
      // the run rather than colliding with BA-0001.
      admissionNoFormat: 'BA-{####}',
      slug: 'brighton-academy',
      motto: 'Knowledge · Discipline · Service',
      address: 'Adjiringanor Road, East Legon, Accra',
      phone: '+233 24 000 0000',
      email: 'info@brightonacademy.edu.gh',
      region: 'Greater Accra',
      website: 'www.brightonacademy.edu.gh',
      brandColor: '#002b5b',
      tier: 'MEDIUM',
      smsSenderId: 'BRIGHTON',
      smsCredits: 500,
    },
  });
  const sid = school.id;

  /*
   * The demo school's crest, written through the storage provider rather than straight to disk,
   * so seeding an S3-backed environment works the same as a local one and the stored key has the
   * exact shape an upload through the API would produce.
   *
   * Cosmetic, so a failure here must not take the seed down with it: the portal already falls
   * back to the school's initials when there is no crest, and losing a demo logo is not worth
   * losing the whole dataset over.
   */
  try {
    const crest = readFileSync(join(__dirname, 'assets', 'school-crest.png'));
    const crestKey = objectKey(sid, 'logo', sid, 'school-crest.png');
    await storage().put(crestKey, crest, 'image/png');
    // logoMimeType too: the crest is served to the open internet by /public/branding/logo now,
    // and guessing a content type there is not on.
    await db.school.update({
      where: { id: sid },
      data: { logoUrl: crestKey, logoMimeType: 'image/png' },
    });
  } catch (e) {
    console.warn('Could not install the demo crest, continuing without it:', e);
  }

  // Every school gets the preset roles. Without them nobody but the proprietor can do anything,
  // because authority now comes from a role rather than the legacy enum.
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
  // The proprietor is still created — only the unused binding is dropped, which lint rejects.
  const [, head, bursar, teacher] = await Promise.all([
    db.user.create({
      data: {
        schoolId: sid,
        name: 'Alexander Odoom',
        email: 'owner@demo.school',
        role: 'OWNER',
        passwordHash: hash,
      },
    }),
    db.user.create({
      data: {
        schoolId: sid,
        name: 'Mrs. Dora Ampofo',
        email: 'head@demo.school',
        role: 'HEAD',
        staffRoleId: roleByKey.get('HEAD'),
        passwordHash: hash,
      },
    }),
    db.user.create({
      data: {
        schoolId: sid,
        name: 'Mr. Ebo Quaye',
        email: 'bursar@demo.school',
        role: 'BURSAR',
        staffRoleId: roleByKey.get('BURSAR'),
        passwordHash: hash,
      },
    }),
    db.user.create({
      data: {
        schoolId: sid,
        name: 'Ms. Efua Sarpong',
        email: 'teacher@demo.school',
        role: 'TEACHER',
        staffRoleId: roleByKey.get('CLASS_TEACHER'),
        passwordHash: hash,
      },
    }),
  ]);

  const year = await db.academicYear.create({
    data: {
      schoolId: sid,
      name: '2025/2026',
      startDate: new Date('2025-09-15'),
      endDate: new Date('2026-08-06'),
      isCurrent: true,
    },
  });
  const [t1, t2, t3] = await Promise.all([
    db.term.create({
      data: {
        academicYearId: year.id,
        name: 'Term 1',
        startDate: new Date('2025-09-15'),
        endDate: new Date('2025-12-18'),
        nextTermBegins: new Date('2026-01-08'),
        isCurrent: false,
      },
    }),
    db.term.create({
      data: {
        academicYearId: year.id,
        name: 'Term 2',
        startDate: new Date('2026-01-08'),
        endDate: new Date('2026-04-02'),
        nextTermBegins: new Date('2026-04-28'),
        isCurrent: false,
      },
    }),
    db.term.create({
      data: {
        academicYearId: year.id,
        name: 'Term 3',
        startDate: new Date('2026-04-28'),
        endDate: new Date('2026-08-06'),
        nextTermBegins: new Date('2026-09-14'),
        isCurrent: true,
      },
    }),
  ]);

  const levelDefs: Array<[string, 'PRE_SCHOOL' | 'PRIMARY' | 'JHS', number]> = [
    ['KG 1', 'PRE_SCHOOL', 1],
    ['KG 2', 'PRE_SCHOOL', 2],
    ['Basic 1', 'PRIMARY', 3],
    ['Basic 2', 'PRIMARY', 4],
    ['Basic 3', 'PRIMARY', 5],
    ['Basic 4', 'PRIMARY', 6],
    ['Basic 5', 'PRIMARY', 7],
    ['Basic 6', 'PRIMARY', 8],
    ['JHS 1', 'JHS', 9],
    ['JHS 2', 'JHS', 10],
    ['JHS 3', 'JHS', 11],
  ];
  // Grading schemes, then per-level selection: pre-school → early-years, everyone else → GES.
  const gesScheme = await db.gradingScheme.create({
    data: { schoolId: sid, name: 'GES Classic (1–9)', kind: 'GES_CLASSIC', bands: GES_BANDS },
  });
  await db.gradingScheme.create({
    data: { schoolId: sid, name: 'NaCCA Proficiency', kind: 'NACCA_BANDS', bands: NACCA_BANDS },
  });
  const earlyScheme = await db.gradingScheme.create({
    data: {
      schoolId: sid,
      name: 'Early Years Observation',
      kind: 'EARLY_YEARS',
      bands: EARLY_YEARS_BANDS,
    },
  });

  const levels = await Promise.all(
    levelDefs.map(([name, category, order]) =>
      db.level.create({
        data: {
          schoolId: sid,
          name,
          category,
          order,
          gradingSchemeId: category === 'PRE_SCHOOL' ? earlyScheme.id : gesScheme.id,
        },
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
    ['Mathematics', 'MATH', true],
    ['Integrated Science', 'SCI', true],
    ['Social Studies', 'SOC', true],
    ['Religious & Moral Education', 'RME', false],
    ['Computing', 'ICT', false],
    ['Ghanaian Language (Twi)', 'TWI', false],
    ['Creative Arts', 'ART', false],
  ];
  const subjects = await Promise.all(
    subjectDefs.map(([name, code, isCore]) =>
      db.subject.create({ data: { schoolId: sid, name, code, isCore } }),
    ),
  );

  const components = await Promise.all([
    db.assessmentComponent.create({
      data: { schoolId: sid, name: 'Class Test 1', maxScore: 20, order: 1 },
    }),
    db.assessmentComponent.create({
      data: { schoolId: sid, name: 'Class Test 2', maxScore: 20, order: 2 },
    }),
    db.assessmentComponent.create({
      data: { schoolId: sid, name: 'Project Work', maxScore: 20, order: 3 },
    }),
    db.assessmentComponent.create({
      data: { schoolId: sid, name: 'End of Term Exam', maxScore: 100, category: 'EXAM', order: 4 },
    }),
  ]);

  // A component scoped to one subject, to show that components need not be school-wide:
  // Integrated Science in JHS carries a practical that no other subject has.
  const science = subjects.find((s) => s.name.includes('Science'));
  const jhs2Level = levels.find((l) => l.name === 'JHS 2');
  if (science && jhs2Level) {
    await db.assessmentComponent.create({
      data: {
        schoolId: sid,
        name: 'Practical',
        maxScore: 20,
        category: 'CONTINUOUS',
        subjectId: science.id,
        levelId: jhs2Level.id,
        order: 5,
      },
    });
  }

  // Students: 12 in JHS 2 (rich data), 8 each in Basic 4 & Basic 5, 5 in KG 1
  const focus = [
    { cls: classes[9], count: 12, prefix: 'J2' }, // JHS 2
    { cls: classes[5], count: 8, prefix: 'B4' }, // Basic 4
    { cls: classes[6], count: 8, prefix: 'B5' }, // Basic 5
    { cls: classes[0], count: 5, prefix: 'KG' }, // KG 1
  ];
  let admissionSeq = 1;
  const allStudents: { id: string; classId: string; first: string; last: string }[] = [];
  /** One guardian per surname, so siblings genuinely share a parent. */
  const guardiansByFamily = new Map<string, { id: string }>();
  for (const grp of focus) {
    for (let i = 0; i < grp.count; i++) {
      const male = rng() > 0.5;
      const first = male ? pick(FIRST_M) : pick(FIRST_F);
      const last = pick(LAST);
      const st = await db.student.create({
        data: {
          schoolId: sid,
          admissionNo: `BA-${String(admissionSeq++).padStart(4, '0')}`,
          firstName: first,
          lastName: last,
          gender: male ? 'MALE' : 'FEMALE',
          dateOfBirth: new Date(
            2012 + Math.floor(rng() * 8),
            Math.floor(rng() * 12),
            1 + Math.floor(rng() * 27),
          ),
          classId: grp.cls.id,
        },
      });
      allStudents.push({ id: st.id, classId: grp.cls.id, first, last });
      // Real schools are full of siblings, and features like the sibling discount are invisible
      // without them. Children sharing a surname share a parent, which is how the production
      // code deduplicates guardians anyway — one guardian row per phone, reused across siblings.
      const existing = guardiansByFamily.get(last);
      const guardian =
        existing ??
        (await db.guardian.create({
          data: {
            schoolId: sid,
            firstName: male ? pick(FIRST_F) : pick(FIRST_M),
            lastName: last,
            phone: `+23324${String(1000000 + Math.floor(rng() * 8999999))}`,
            whatsappOptIn: rng() > 0.3,
          },
        }));
      guardiansByFamily.set(last, guardian);
      await db.studentGuardian.create({
        data: {
          studentId: st.id,
          guardianId: guardian.id,
          relationship: male ? 'Mother' : 'Father',
          isPrimary: true,
        },
      });
    }
  }

  // Point the counter past everything the seed issued. Derived from the sequence rather than a
  // literal, so adding demo students never leaves it stale.
  await db.school.update({
    where: { id: sid },
    data: { admissionNoNext: admissionSeq },
  });

  // Attendance for current term (Term 3): 30 school days
  const days: Date[] = [];
  const d = new Date('2026-04-28');
  while (days.length < 30) {
    if (d.getDay() !== 0 && d.getDay() !== 6) days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  const attendanceRows: Prisma.AttendanceRecordCreateManyInput[] = [];
  for (const st of allStudents) {
    for (const day of days) {
      const r = rng();
      attendanceRows.push({
        schoolId: sid,
        studentId: st.id,
        classId: st.classId,
        termId: t3.id,
        date: day,
        status: r < 0.9 ? 'PRESENT' : r < 0.95 ? 'LATE' : 'ABSENT',
        markedById: teacher.id,
      });
    }
  }
  await db.attendanceRecord.createMany({ data: attendanceRows });

  // Scores for JHS 2 + Basic 4/5, all subjects, current term
  const scoreRows: Prisma.ScoreCreateManyInput[] = [];
  const scored = allStudents.filter((s) => s.classId !== classes[0].id);
  for (const st of scored) {
    const ability = 0.35 + rng() * 0.6;
    // All three terms, with a gentle drift per child, so the cumulative record has a shape to
    // show rather than a single point.
    const drift = (rng() - 0.4) * 0.12;
    for (const [i, t] of [t1, t2, t3].entries()) {
      const termAbility = Math.min(0.98, Math.max(0.2, ability + drift * i));
      for (const sub of subjects) {
        for (const comp of components) {
          const frac = Math.min(1, Math.max(0.15, termAbility + (rng() - 0.5) * 0.3));
          scoreRows.push({
            schoolId: sid,
            studentId: st.id,
            subjectId: sub.id,
            termId: t.id,
            componentId: comp.id,
            rawScore: Math.round(frac * comp.maxScore),
            enteredById: teacher.id,
          });
        }
      }
    }
  }
  await db.score.createMany({ data: scoreRows });

  // Fees for current term
  const feeDefs: Array<[string, number, string | null, boolean]> = [
    ['School Fees', 1200, null, false],
    ['PTA Dues', 50, null, false],
    ['Examination Fee', 80, null, false],
    ['ICT Levy', 60, null, false],
    ['Feeding (per term)', 450, null, true],
    ['Transport (per term)', 350, null, true],
  ];
  for (const [name, amount, levelId, optional] of feeDefs) {
    await db.feeItem.create({
      data: { schoolId: sid, termId: t3.id, levelId, name, amount, optional },
    });
  }

  // Concession rules. Without these the sibling discount and scholarship features are invisible
  // in the demo — and, as it turned out, untestable, since nothing exercised the code path.
  const sibling = await db.concessionRule.create({
    data: {
      schoolId: sid,
      name: 'Sibling discount',
      kind: 'SIBLING',
      basis: 'PERCENT',
      value: 25,
      // The eldest pays in full; every child after them gets a quarter off.
      fromSibling: 2,
    },
  });
  const bursary = await db.concessionRule.create({
    data: {
      schoolId: sid,
      name: "Head's bursary",
      kind: 'SCHOLARSHIP',
      basis: 'PERCENT',
      value: 50,
    },
  });
  // Award it to the eldest of the largest family, so both the scholarship and the sibling rule
  // are visible on one screen and their stacking can be seen.
  const familySizes = new Map<string, string[]>();
  for (const st of allStudents) {
    familySizes.set(st.last, [...(familySizes.get(st.last) ?? []), st.id]);
  }
  const biggest = [...familySizes.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (biggest && biggest[1].length > 1) {
    await db.concessionAward.create({
      data: {
        schoolId: sid,
        ruleId: bursary.id,
        studentId: biggest[1][0],
        reason: 'Top of the class, 2025/2026',
      },
    });
  }
  void sibling;

  // Invoices + payments for all students (compulsory items = 1390)
  let invSeq = 1;
  let paySeq = 1;
  let rcpSeq = 1;
  for (const st of allStudents) {
    const lines = [
      { name: 'School Fees', amount: 1200 },
      { name: 'PTA Dues', amount: 50 },
      { name: 'Examination Fee', amount: 80 },
      { name: 'ICT Levy', amount: 60 },
    ];
    const total = lines.reduce((a, l) => a + l.amount, 0);
    const inv = await db.invoice.create({
      data: {
        schoolId: sid,
        studentId: st.id,
        termId: t3.id,
        number: `INV-2026-${String(invSeq++).padStart(4, '0')}`,
        lines,
        total,
      },
    });
    await db.ledgerEntry.create({
      data: {
        schoolId: sid,
        studentId: st.id,
        termId: t3.id,
        type: 'INVOICE',
        amount: total,
        reference: `${inv.number}-CHG`,
        note: `Term 3 invoice ${inv.number}`,
        createdById: bursar.id,
      },
    });
    // 60% fully paid, 25% part-paid, 15% unpaid
    const r = rng();
    const payFraction = r < 0.6 ? 1 : r < 0.85 ? 0.4 + rng() * 0.4 : 0;
    if (payFraction > 0) {
      const amt = Math.round(total * payFraction * 100) / 100;
      const method = rng() < 0.6 ? 'MOMO' : rng() < 0.8 ? 'CASH' : 'BANK';
      const entry = await db.ledgerEntry.create({
        data: {
          schoolId: sid,
          studentId: st.id,
          termId: t3.id,
          type: 'PAYMENT',
          amount: amt,
          method: method as 'MOMO' | 'CASH' | 'BANK',
          reference: `PAY-2026-${String(paySeq++).padStart(5, '0')}`,
          note:
            method === 'MOMO'
              ? 'MTN MoMo'
              : method === 'BANK'
                ? 'Bank deposit — GCB'
                : 'Cash at office',
          createdById: bursar.id,
        },
      });
      await db.receipt.create({
        data: {
          schoolId: sid,
          ledgerEntryId: entry.id,
          number: `RCP-2026-${String(rcpSeq++).padStart(5, '0')}`,
        },
      });
    }
  }

  await db.announcement.create({
    data: {
      schoolId: sid,
      title: 'Mid-term break begins Friday 24 July',
      body: 'School closes at 12:30pm on Friday. Classes resume Monday 3 August. Travel safely!',
      createdById: head.id,
    },
  });
  await db.announcement.create({
    data: {
      schoolId: sid,
      title: 'Term 3 fees reminder',
      body: 'Kindly settle outstanding Term 3 fees before end-of-term examinations begin. Pay via MoMo to 024 000 0000 (Brighton Academy) or at the bursar’s office.',
      createdById: bursar.id,
    },
  });

  console.log(
    `Seeded ${school.name}: ${allStudents.length} students, 3 terms, scores + fees for Term 3.`,
  );
  console.log(
    'Logins (password: Password1!): owner@demo.school · head@demo.school · bursar@demo.school · teacher@demo.school',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
