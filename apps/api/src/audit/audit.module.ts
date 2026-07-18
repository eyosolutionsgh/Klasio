import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Roles } from '../common/auth';

const PAGE_SIZE = 50;

@Injectable()
export class AuditService {
  constructor(private db: PrismaService) {}

  async list(
    auth: AuthUser,
    opts: { action?: string; entity?: string; from?: string; to?: string; page?: string },
  ) {
    const page = Math.max(1, Number(opts.page) || 1);
    const where: Prisma.AuditLogWhereInput = { schoolId: auth.schoolId };
    if (opts.action) where.action = { contains: opts.action, mode: 'insensitive' };
    if (opts.entity) where.entity = opts.entity;
    if (opts.from || opts.to) {
      where.createdAt = {};
      if (opts.from) where.createdAt.gte = new Date(opts.from);
      if (opts.to) {
        // Inclusive end-of-day for the `to` date.
        const end = new Date(opts.to);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const [total, logs] = await Promise.all([
      this.db.auditLog.count({ where }),
      this.db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);

    // AuditLog carries a bare userId; resolve names from the school's users.
    const userIds = [...new Set(logs.map((l) => l.userId).filter((x): x is string => !!x))];
    const users = await this.db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    return {
      total,
      page,
      pageSize: PAGE_SIZE,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      entries: logs.map((l) => ({
        id: l.id,
        action: l.action,
        entity: l.entity,
        entityId: l.entityId,
        detail: l.detail,
        actor: l.userId ? (nameById.get(l.userId) ?? 'Unknown user') : 'System',
        createdAt: l.createdAt,
      })),
    };
  }

  /** Distinct actions present, for the filter dropdown. */
  async actions(auth: AuthUser) {
    const rows = await this.db.auditLog.findMany({
      where: { schoolId: auth.schoolId },
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    });
    return rows.map((r) => r.action);
  }
}

@Controller('audit')
export class AuditController {
  constructor(private svc: AuditService) {}

  @Get()
  @Roles('OWNER', 'HEAD')
  list(
    @CurrentUser() user: AuthUser,
    @Query('action') action?: string,
    @Query('entity') entity?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
  ) {
    return this.svc.list(user, { action, entity, from, to, page });
  }

  @Get('actions')
  @Roles('OWNER', 'HEAD')
  actions(@CurrentUser() user: AuthUser) {
    return this.svc.actions(user);
  }
}

@Module({ controllers: [AuditController], providers: [AuditService] })
export class AuditModule {}
