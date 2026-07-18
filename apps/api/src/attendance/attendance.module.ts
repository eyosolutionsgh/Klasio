import { Body, Controller, Get, Injectable, Module, Post, Query } from '@nestjs/common';
import { IsArray, IsDateString, IsEnum, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AttendanceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser } from '../common/auth';

class AttendanceEntryDto {
  @IsString() studentId: string;
  @IsEnum(AttendanceStatus) status: AttendanceStatus;
}

class MarkAttendanceDto {
  @IsString() classId: string;
  @IsDateString() date: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  entries: AttendanceEntryDto[];
}

@Injectable()
export class AttendanceService {
  constructor(private db: PrismaService) {}

  private async currentTermId(schoolId: string): Promise<string | null> {
    const term = await this.db.term.findFirst({
      where: { isCurrent: true, academicYear: { schoolId, isCurrent: true } },
    });
    return term?.id ?? null;
  }

  async roster(auth: AuthUser, classId: string, date: string) {
    const day = new Date(date);
    const [students, existing] = await Promise.all([
      this.db.student.findMany({
        where: { schoolId: auth.schoolId, classId, status: 'ACTIVE' },
        orderBy: { lastName: 'asc' },
        select: { id: true, admissionNo: true, firstName: true, lastName: true, gender: true },
      }),
      this.db.attendanceRecord.findMany({ where: { classId, date: day } }),
    ]);
    const byStudent = new Map(existing.map((r) => [r.studentId, r.status]));
    return students.map((s) => ({
      id: s.id,
      admissionNo: s.admissionNo,
      name: `${s.firstName} ${s.lastName}`,
      gender: s.gender,
      status: byStudent.get(s.id) ?? null,
    }));
  }

  async mark(auth: AuthUser, dto: MarkAttendanceDto) {
    const termId = await this.currentTermId(auth.schoolId);
    if (!termId) throw new Error('No current term configured');
    const day = new Date(dto.date);
    let saved = 0;
    for (const entry of dto.entries) {
      await this.db.attendanceRecord.upsert({
        where: { studentId_date: { studentId: entry.studentId, date: day } },
        update: { status: entry.status, markedById: auth.sub },
        create: {
          schoolId: auth.schoolId,
          studentId: entry.studentId,
          classId: dto.classId,
          termId,
          date: day,
          status: entry.status,
          markedById: auth.sub,
        },
      });
      saved++;
    }
    await this.db.audit(auth.schoolId, auth.sub, 'attendance.mark', 'ClassRoom', dto.classId, {
      date: dto.date,
      count: saved,
    });
    return { saved };
  }

  async summary(auth: AuthUser, date: string) {
    const day = new Date(date);
    const grouped = await this.db.attendanceRecord.groupBy({
      by: ['status'],
      where: { schoolId: auth.schoolId, date: day },
      _count: true,
    });
    const activeStudents = await this.db.student.count({
      where: { schoolId: auth.schoolId, status: 'ACTIVE' },
    });
    const counts = grouped.reduce(
      (acc, g) => ({ ...acc, [g.status]: g._count }),
      {} as Record<string, number>,
    );
    return { date, activeStudents, counts };
  }
}

@Controller('attendance')
export class AttendanceController {
  constructor(private svc: AttendanceService) {}

  @Get('roster')
  roster(
    @CurrentUser() user: AuthUser,
    @Query('classId') classId: string,
    @Query('date') date: string,
  ) {
    return this.svc.roster(user, classId, date);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query('date') date: string) {
    return this.svc.summary(user, date);
  }

  @Post('mark')
  mark(@CurrentUser() user: AuthUser, @Body() dto: MarkAttendanceDto) {
    return this.svc.mark(user, dto);
  }
}

@Module({ controllers: [AttendanceController], providers: [AttendanceService] })
export class AttendanceModule {}
