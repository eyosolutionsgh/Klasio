import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser } from '../common/auth';

@Injectable()
export class SchoolsService {
  constructor(private db: PrismaService) {}

  async structure(auth: AuthUser) {
    const [levels, classes, subjects, years] = await Promise.all([
      this.db.level.findMany({ where: { schoolId: auth.schoolId }, orderBy: { order: 'asc' } }),
      this.db.classRoom.findMany({
        where: { schoolId: auth.schoolId },
        include: { level: true, _count: { select: { students: { where: { status: 'ACTIVE' } } } } },
        orderBy: { level: { order: 'asc' } },
      }),
      this.db.subject.findMany({
        where: { schoolId: auth.schoolId },
        orderBy: [{ isCore: 'desc' }, { name: 'asc' }],
      }),
      this.db.academicYear.findMany({
        where: { schoolId: auth.schoolId },
        include: { terms: { orderBy: { startDate: 'asc' } } },
        orderBy: { startDate: 'desc' },
      }),
    ]);
    return {
      levels,
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        level: c.level.name,
        category: c.level.category,
        studentCount: c._count.students,
      })),
      subjects,
      years,
    };
  }
}

@Controller('school')
export class SchoolsController {
  constructor(private svc: SchoolsService) {}

  @Get('structure')
  structure(@CurrentUser() user: AuthUser) {
    return this.svc.structure(user);
  }
}

@Module({ controllers: [SchoolsController], providers: [SchoolsService] })
export class SchoolsModule {}
