import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Gender, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireEntitlement, Roles } from '../common/auth';
import { enrolmentHeadroom, studentCapFor } from '../common/entitlements';
import { parseXlsx, templateXlsx, TemplateSpec } from '../common/export';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Minimal shape of a Multer upload — avoids depending on @types/multer. */
interface UploadedXlsx {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

type Kind = 'students' | 'fees' | 'balances';

const TEMPLATES: Record<Kind, TemplateSpec> = {
  students: {
    sheetName: 'Students',
    headers: [
      'First Name',
      'Last Name',
      'Other Names',
      'Gender',
      'Date of Birth',
      'Class',
      'Guardian Name',
      'Guardian Phone',
      'Guardian Relationship',
    ],
    sample: [
      [
        'Ama',
        'Mensah',
        '',
        'Female',
        '2015-03-12',
        'Basic 4',
        'Kofi Mensah',
        '0241234567',
        'Father',
      ],
      [
        'Yaw',
        'Boateng',
        '',
        'Male',
        '2014-09-01',
        'Basic 5',
        'Akosua Boateng',
        '0209876543',
        'Mother',
      ],
    ],
    notes: [
      'Gender: Male or Female. Date of Birth: YYYY-MM-DD.',
      'Class must exactly match an existing class name. Guardian columns are optional.',
    ],
  },
  fees: {
    sheetName: 'Fee Structure',
    headers: ['Item Name', 'Amount', 'Level', 'Optional'],
    sample: [
      ['Tuition', 1200, '', 'No'],
      ['PTA Dues', 50, '', 'No'],
      ['Transport', 300, '', 'Yes'],
    ],
    notes: [
      'Items are added to the current term. Level is optional (blank = all levels).',
      'Optional: Yes for opt-in items (e.g. transport), No for compulsory fees.',
    ],
  },
  balances: {
    sheetName: 'Opening Balances',
    headers: ['Admission No.', 'Amount', 'Note'],
    sample: [
      ['BA-0001', 450, 'Arrears from previous term'],
      ['BA-0002', 0, ''],
    ],
    notes: [
      'Amount is the outstanding balance owed. Admission No. must match an existing student.',
    ],
  },
};

interface ImportResult {
  imported: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

@Injectable()
export class OnboardingService {
  constructor(private db: PrismaService) {}

  template(kind: Kind) {
    const spec = TEMPLATES[kind];
    if (!spec) throw new BadRequestException('Unknown template');
    return templateXlsx(spec);
  }

  async import(auth: AuthUser, kind: Kind, buffer: Buffer): Promise<ImportResult> {
    if (!TEMPLATES[kind]) throw new BadRequestException('Unknown import kind');
    const rows = await parseXlsx(buffer);
    if (rows.length === 0) throw new BadRequestException('The spreadsheet has no data rows');
    const result =
      kind === 'students'
        ? await this.importStudents(auth, rows)
        : kind === 'fees'
          ? await this.importFees(auth, rows)
          : await this.importBalances(auth, rows);
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      `onboarding.import.${kind}`,
      'School',
      auth.schoolId,
      {
        imported: result.imported,
        skipped: result.skipped,
        errors: result.errors.length,
      },
    );
    return result;
  }

  private async importStudents(
    auth: AuthUser,
    rows: Record<string, string>[],
  ): Promise<ImportResult> {
    const classes = await this.db.classRoom.findMany({ where: { schoolId: auth.schoolId } });
    const classByName = new Map(classes.map((c) => [c.name.toLowerCase(), c.id]));
    let seq = await this.db.student.count({ where: { schoolId: auth.schoolId } });
    const errors: { row: number; message: string }[] = [];
    let imported = 0;

    // Import up to the package cap, then report the remainder as row errors rather than
    // failing the whole file — a partial import is far more useful mid-onboarding.
    const activeCount = await this.db.student.count({
      where: { schoolId: auth.schoolId, status: 'ACTIVE' },
    });
    let headroom = enrolmentHeadroom(auth.tier, activeCount);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const line = i + 2; // header is row 1
      const firstName = r['First Name'];
      const lastName = r['Last Name'];
      const genderRaw = (r['Gender'] ?? '').toLowerCase();
      const gender: Gender | null = /^m|boy/.test(genderRaw)
        ? 'MALE'
        : /^f|girl/.test(genderRaw)
          ? 'FEMALE'
          : null;
      const dob = r['Date of Birth'];
      const classId = classByName.get((r['Class'] ?? '').toLowerCase());

      if (!firstName || !lastName) {
        errors.push({ row: line, message: 'First Name and Last Name are required' });
        continue;
      }
      if (!gender) {
        errors.push({ row: line, message: `Gender must be Male or Female (got "${r['Gender']}")` });
        continue;
      }
      const dobDate = dob ? new Date(dob) : null;
      if (!dobDate || isNaN(dobDate.getTime())) {
        errors.push({ row: line, message: `Invalid Date of Birth "${dob}" (use YYYY-MM-DD)` });
        continue;
      }
      if (!classId) {
        errors.push({ row: line, message: `Unknown class "${r['Class']}"` });
        continue;
      }
      if (headroom <= 0) {
        errors.push({
          row: line,
          message: `Package student limit (${studentCapFor(auth.tier)}) reached — not enrolled`,
        });
        continue;
      }

      headroom--;
      seq++;
      const student = await this.db.student.create({
        data: {
          schoolId: auth.schoolId,
          admissionNo: `BA-${String(seq).padStart(4, '0')}`,
          firstName,
          lastName,
          otherNames: r['Other Names'] || null,
          gender,
          dateOfBirth: dobDate,
          classId,
        },
      });
      if (r['Guardian Name'] && r['Guardian Phone']) {
        const [gFirst, ...gRest] = r['Guardian Name'].split(' ');
        const guardian = await this.db.guardian.create({
          data: {
            schoolId: auth.schoolId,
            firstName: gFirst,
            lastName: gRest.join(' ') || lastName,
            phone: r['Guardian Phone'],
          },
        });
        await this.db.studentGuardian.create({
          data: {
            studentId: student.id,
            guardianId: guardian.id,
            relationship: r['Guardian Relationship'] || 'Guardian',
            isPrimary: true,
          },
        });
      }
      imported++;
    }
    return { imported, skipped: rows.length - imported, errors };
  }

  private async importFees(auth: AuthUser, rows: Record<string, string>[]): Promise<ImportResult> {
    const term = await this.db.term.findFirst({
      where: { isCurrent: true, academicYear: { schoolId: auth.schoolId, isCurrent: true } },
    });
    if (!term) throw new BadRequestException('No current term set — cannot import fee items');
    const levels = await this.db.level.findMany({ where: { schoolId: auth.schoolId } });
    const levelByName = new Map(levels.map((l) => [l.name.toLowerCase(), l.id]));
    const errors: { row: number; message: string }[] = [];
    let imported = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const line = i + 2;
      const name = r['Item Name'];
      const amount = Number(r['Amount']);
      if (!name) {
        errors.push({ row: line, message: 'Item Name is required' });
        continue;
      }
      if (!isFinite(amount) || amount < 0) {
        errors.push({ row: line, message: `Invalid Amount "${r['Amount']}"` });
        continue;
      }
      let levelId: string | undefined;
      if (r['Level']) {
        levelId = levelByName.get(r['Level'].toLowerCase());
        if (!levelId) {
          errors.push({ row: line, message: `Unknown level "${r['Level']}"` });
          continue;
        }
      }
      const optional = /^(y|yes|true|1)$/i.test((r['Optional'] ?? '').trim());
      await this.db.feeItem.create({
        data: {
          schoolId: auth.schoolId,
          termId: term.id,
          levelId: levelId ?? null,
          name,
          amount: new Prisma.Decimal(amount),
          optional,
        },
      });
      imported++;
    }
    return { imported, skipped: rows.length - imported, errors };
  }

  private async importBalances(
    auth: AuthUser,
    rows: Record<string, string>[],
  ): Promise<ImportResult> {
    const term = await this.db.term.findFirst({
      where: { isCurrent: true, academicYear: { schoolId: auth.schoolId, isCurrent: true } },
    });
    const students = await this.db.student.findMany({
      where: { schoolId: auth.schoolId },
      select: { id: true, admissionNo: true },
    });
    const byAdm = new Map(students.map((s) => [s.admissionNo.toLowerCase(), s.id]));
    const errors: { row: number; message: string }[] = [];
    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const line = i + 2;
      const adm = (r['Admission No.'] ?? '').trim();
      const amount = Number(r['Amount']);
      const studentId = byAdm.get(adm.toLowerCase());
      if (!studentId) {
        errors.push({ row: line, message: `Unknown admission no. "${adm}"` });
        continue;
      }
      if (!isFinite(amount) || amount < 0) {
        errors.push({ row: line, message: `Invalid Amount "${r['Amount']}"` });
        continue;
      }
      if (amount === 0) {
        skipped++;
        continue;
      }
      try {
        await this.db.ledgerEntry.create({
          data: {
            schoolId: auth.schoolId,
            studentId,
            termId: term?.id ?? null,
            type: 'INVOICE',
            amount: new Prisma.Decimal(amount),
            reference: `OPEN-${adm}`,
            note: r['Note'] || 'Opening balance',
            createdById: auth.sub,
          },
        });
        imported++;
      } catch {
        errors.push({ row: line, message: `${adm} already has an opening balance` });
      }
    }
    return { imported, skipped, errors };
  }
}

@Controller('onboarding')
export class OnboardingController {
  constructor(private svc: OnboardingService) {}

  @Get('templates/:kind')
  @RequireEntitlement('platform.export')
  async template(@Param('kind') kind: Kind) {
    const buffer = await this.svc.template(kind);
    return new StreamableFile(buffer, {
      type: XLSX_MIME,
      disposition: `attachment; filename="eyo-${kind}-template.xlsx"`,
    });
  }

  @Post('import/:kind')
  @RequireEntitlement('platform.export')
  @Roles('OWNER', 'HEAD', 'BURSAR', 'FRONT_DESK')
  @UseInterceptors(FileInterceptor('file'))
  import(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: Kind,
    @UploadedFile() file: UploadedXlsx,
  ) {
    if (!file?.buffer) throw new BadRequestException('No file uploaded');
    return this.svc.import(user, kind, file.buffer);
  }
}

@Module({ controllers: [OnboardingController], providers: [OnboardingService] })
export class OnboardingModule {}
