import { Controller, Get, Injectable, Module, Query, StreamableFile } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireEntitlement, RequirePermission } from '../common/auth';
import { Cell, toCsv, toXlsx } from '../common/export';
import { PageQuery, dateWindow, orderBy, pageArgs, toPage } from '../common/list-query';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Which columns the trail may be sorted by.
 *
 * An allowlist rather than a passthrough — `sort` comes off a query string and is spread straight
 * into `orderBy`, so an unchecked value would let a caller order by a column this endpoint never
 * meant to expose. The actor is deliberately absent: `AuditLog.userId` is a bare id with no
 * relation, and the names are resolved in a second query after the page has been chosen, so
 * "sort by actor" could only ever order by an opaque cuid.
 */
const AUDIT_SORTS: Record<string, string | string[]> = {
  createdAt: 'createdAt',
  action: 'action',
  entity: ['entity', 'entityId'],
};

/**
 * The trail's filters. Extends the shared paging/sorting/date-window base; `from`/`to` filter
 * `createdAt` — when the change was recorded, which is the only time an audit row carries.
 */
class ListAuditDto extends PageQuery {
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() entity?: string;
}

@Injectable()
export class AuditService {
  constructor(private db: PrismaService) {}

  /**
   * The trail, paged.
   *
   * The page size used to be a fixed 50 with no way to change it, and the response invented its
   * own envelope shape. Both are now the shared ones, so the trail pages, sorts and sizes like
   * every other list in the portal.
   */
  async list(auth: AuthUser, q: ListAuditDto) {
    const { skip, take, page, perPage } = pageArgs(q);
    const recorded = dateWindow(q);
    const where: Prisma.AuditLogWhereInput = { schoolId: auth.schoolId };
    if (q.action) where.action = { contains: q.action, mode: 'insensitive' };
    if (q.entity) where.entity = q.entity;
    // The window filters when the change was recorded — an audit row has no other date.
    if (recorded) where.createdAt = recorded;

    const [total, logs] = await Promise.all([
      this.db.auditLog.count({ where }),
      this.db.auditLog.findMany({
        where,
        orderBy: orderBy<Prisma.AuditLogOrderByWithRelationInput>(q, AUDIT_SORTS, {
          createdAt: 'desc',
        }),
        skip,
        take,
      }),
    ]);

    // AuditLog carries a bare userId; resolve names from the school's users.
    const userIds = [...new Set(logs.map((l) => l.userId).filter((x): x is string => !!x))];
    const users = await this.db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    const rows = logs.map((l) => ({
      id: l.id,
      action: l.action,
      entity: l.entity,
      entityId: l.entityId,
      detail: l.detail,
      actor: l.userId ? (nameById.get(l.userId) ?? 'Unknown user') : 'System',
      createdAt: l.createdAt,
    }));
    return toPage(rows, total, { page, perPage });
  }

  /**
   * The change log as a file (FEATURES.md §19: "export anything — … and the change log"). The
   * whole filtered trail, not a page of it, ordered oldest-first the way an auditor reads.
   */
  async export(auth: AuthUser, q: ListAuditDto, format: string) {
    const recorded = dateWindow(q);
    const where: Prisma.AuditLogWhereInput = { schoolId: auth.schoolId };
    if (q.action) where.action = { contains: q.action, mode: 'insensitive' };
    if (q.entity) where.entity = q.entity;
    if (recorded) where.createdAt = recorded;

    const logs = await this.db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const userIds = [...new Set(logs.map((l) => l.userId).filter((x): x is string => !!x))];
    const users = await this.db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    const headers = ['When', 'Who', 'Action', 'Entity', 'Entity Id', 'Detail'];
    const rows: Cell[][] = logs.map((l) => [
      l.createdAt.toISOString(),
      l.userId ? (nameById.get(l.userId) ?? 'Unknown user') : 'System',
      l.action,
      l.entity,
      l.entityId ?? '',
      l.detail ? JSON.stringify(l.detail) : '',
    ]);
    if (format === 'csv') {
      return { buffer: toCsv(headers, rows), type: 'text/csv', filename: 'change-log.csv' };
    }
    return {
      buffer: await toXlsx('Change log', headers, rows),
      type: XLSX_MIME,
      filename: 'change-log.xlsx',
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

  /**
   * Distinct entities present, for the filter dropdown.
   *
   * The `entity` filter has always been accepted by the endpoint but was unreachable from the
   * portal, so "show me everything that happened to Students" could only be asked by hand-editing
   * a URL. This is the list the control needs to exist.
   */
  async entities(auth: AuthUser) {
    const rows = await this.db.auditLog.findMany({
      where: { schoolId: auth.schoolId },
      distinct: ['entity'],
      select: { entity: true },
      orderBy: { entity: 'asc' },
    });
    return rows.map((r) => r.entity);
  }
}

@Controller('audit')
export class AuditController {
  constructor(private svc: AuditService) {}

  @Get()
  @RequirePermission('audit.view')
  list(@CurrentUser() user: AuthUser, @Query() query: ListAuditDto) {
    return this.svc.list(user, query);
  }

  @Get('export')
  @RequirePermission('audit.view')
  @RequireEntitlement('platform.export')
  async export(
    @CurrentUser() user: AuthUser,
    @Query() query: ListAuditDto,
    @Query('format') format = 'xlsx',
  ) {
    const { buffer, type, filename } = await this.svc.export(user, query, format);
    return new StreamableFile(buffer, {
      type,
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get('actions')
  @RequirePermission('audit.view')
  actions(@CurrentUser() user: AuthUser) {
    return this.svc.actions(user);
  }

  @Get('entities')
  @RequirePermission('audit.view')
  entities(@CurrentUser() user: AuthUser) {
    return this.svc.entities(user);
  }
}

@Module({ controllers: [AuditController], providers: [AuditService] })
export class AuditModule {}
