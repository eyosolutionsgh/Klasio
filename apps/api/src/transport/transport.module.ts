/**
 * School transport (FEATURES.md §10, safety.transport): routes and stops, who rides which bus,
 * and boarding/alighting scans. No live GPS by deliberate scope — the scan log, not a map dot,
 * is what answers "was my child on the bus".
 *
 * Billing rides the fees module: a route may point at an optional FeeItem, and assigning a
 * rider subscribes them to it (removing them unsubscribes). Money never lives here.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthUser,
  CurrentUser,
  RequireAnyPermission,
  RequireEntitlement,
  RequirePermission,
} from '../common/auth';

class RouteDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  /** Optional fee item this route bills through. Empty string clears it. */
  @IsOptional() @IsString() feeItemId?: string;
}

class StopDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @IsInt() order?: number;
}

class RiderDto {
  @IsString() studentId: string;
  @IsOptional() @IsString() stopId?: string;
}

class ScanDto {
  /** Either a student id, or the admission number off the child's ID card QR. */
  @IsOptional() @IsString() studentId?: string;
  @IsOptional() @IsString() admissionNo?: string;
  @IsString() routeId: string;
  @IsIn(['BOARD', 'ALIGHT']) direction: 'BOARD' | 'ALIGHT';
  /** Idempotency key from the device — the bus is the definition of offline. */
  @IsOptional() @IsString() clientRef?: string;
}

@Injectable()
export class TransportService {
  constructor(private db: PrismaService) {}

  // ── Routes & stops ─────────────────────────────────────────────────

  async routes(auth: AuthUser) {
    const rows = await this.db.transportRoute.findMany({
      where: { schoolId: auth.schoolId },
      include: {
        stops: { orderBy: { order: 'asc' } },
        _count: { select: { riders: true } },
      },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      feeItemId: r.feeItemId,
      stops: r.stops.map((s) => ({ id: s.id, name: s.name, order: s.order })),
      riders: r._count.riders,
    }));
  }

  private async resolveFeeItem(auth: AuthUser, feeItemId?: string): Promise<string | null> {
    if (!feeItemId) return null;
    const item = await this.db.feeItem.findFirst({
      where: { id: feeItemId, schoolId: auth.schoolId },
    });
    if (!item) throw new NotFoundException('Fee item not found');
    if (!item.optional) {
      throw new BadRequestException(
        'Pick an optional fee item — everyone is billed the compulsory ones already',
      );
    }
    return item.id;
  }

  async createRoute(auth: AuthUser, dto: RouteDto) {
    const route = await this.db.transportRoute.create({
      data: {
        schoolId: auth.schoolId,
        name: dto.name.trim(),
        description: dto.description?.trim(),
        feeItemId: await this.resolveFeeItem(auth, dto.feeItemId),
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'transport.route.create',
      'TransportRoute',
      route.id,
      {
        name: dto.name,
      },
    );
    return route;
  }

  async updateRoute(auth: AuthUser, id: string, dto: Partial<RouteDto>) {
    const existing = await this.db.transportRoute.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!existing) throw new NotFoundException('Route not found');
    return this.db.transportRoute.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.feeItemId !== undefined
          ? { feeItemId: await this.resolveFeeItem(auth, dto.feeItemId || undefined) }
          : {}),
      },
    });
  }

  async deleteRoute(auth: AuthUser, id: string) {
    const route = await this.db.transportRoute.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: { _count: { select: { riders: true } } },
    });
    if (!route) throw new NotFoundException('Route not found');
    if (route._count.riders > 0) {
      throw new BadRequestException(
        `${route._count.riders} child${route._count.riders === 1 ? '' : 'ren'} still ride this route. Move them first.`,
      );
    }
    await this.db.transportRoute.delete({ where: { id } });
    await this.db.audit(auth.schoolId, auth.sub, 'transport.route.delete', 'TransportRoute', id, {
      name: route.name,
    });
    return { deleted: true };
  }

  async addStop(auth: AuthUser, routeId: string, dto: StopDto) {
    const route = await this.db.transportRoute.findFirst({
      where: { id: routeId, schoolId: auth.schoolId },
    });
    if (!route) throw new NotFoundException('Route not found');
    const last = await this.db.transportStop.findFirst({
      where: { routeId },
      orderBy: { order: 'desc' },
    });
    return this.db.transportStop.create({
      data: {
        schoolId: auth.schoolId,
        routeId,
        name: dto.name.trim(),
        order: dto.order ?? (last?.order ?? 0) + 1,
      },
    });
  }

  async deleteStop(auth: AuthUser, id: string) {
    const stop = await this.db.transportStop.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!stop) throw new NotFoundException('Stop not found');
    // Riders at this stop keep their route; the stop reference frees (SetNull).
    await this.db.transportStop.delete({ where: { id } });
    return { deleted: true };
  }

  // ── Riders & manifests ─────────────────────────────────────────────

  /** Put a child on a route — moving buses is an upsert, one route per child. */
  async assignRider(auth: AuthUser, routeId: string, dto: RiderDto) {
    const [route, student] = await Promise.all([
      this.db.transportRoute.findFirst({ where: { id: routeId, schoolId: auth.schoolId } }),
      this.db.student.findFirst({
        where: { id: dto.studentId, schoolId: auth.schoolId, status: 'ACTIVE' },
      }),
    ]);
    if (!route) throw new NotFoundException('Route not found');
    if (!student) throw new NotFoundException('Student not found');
    if (dto.stopId) {
      const stop = await this.db.transportStop.findFirst({
        where: { id: dto.stopId, routeId, schoolId: auth.schoolId },
      });
      if (!stop) throw new NotFoundException('That stop is not on this route');
    }

    const previous = await this.db.transportRider.findUnique({
      where: { studentId: student.id },
      include: { route: { select: { feeItemId: true } } },
    });
    await this.db.transportRider.upsert({
      where: { studentId: student.id },
      create: {
        schoolId: auth.schoolId,
        studentId: student.id,
        routeId,
        stopId: dto.stopId ?? null,
      },
      update: { routeId, stopId: dto.stopId ?? null },
    });

    // Billing follows the seat: unsubscribe the old route's item, subscribe the new one's.
    const oldItem = previous?.route.feeItemId ?? null;
    if (oldItem && oldItem !== route.feeItemId) {
      await this.db.studentFeeItem.deleteMany({
        where: { schoolId: auth.schoolId, studentId: student.id, feeItemId: oldItem },
      });
    }
    if (route.feeItemId) {
      await this.db.studentFeeItem.upsert({
        where: {
          studentId_feeItemId: { studentId: student.id, feeItemId: route.feeItemId },
        },
        create: { schoolId: auth.schoolId, studentId: student.id, feeItemId: route.feeItemId },
        update: {},
      });
    }
    await this.db.audit(auth.schoolId, auth.sub, 'transport.rider.assign', 'Student', student.id, {
      routeId,
    });
    return { ok: true };
  }

  async removeRider(auth: AuthUser, studentId: string) {
    const rider = await this.db.transportRider.findUnique({
      where: { studentId },
      include: { route: { select: { feeItemId: true } } },
    });
    if (!rider) throw new NotFoundException('Not on any route');
    await this.db.transportRider.delete({ where: { id: rider.id } });
    if (rider.route.feeItemId) {
      await this.db.studentFeeItem.deleteMany({
        where: { schoolId: auth.schoolId, studentId, feeItemId: rider.route.feeItemId },
      });
    }
    await this.db.audit(auth.schoolId, auth.sub, 'transport.rider.remove', 'Student', studentId);
    return { ok: true };
  }

  /** The bus manifest: who should be aboard, by stop, with today's scans laid alongside. */
  async manifest(auth: AuthUser, routeId: string) {
    const route = await this.db.transportRoute.findFirst({
      where: { id: routeId, schoolId: auth.schoolId },
      include: { stops: { orderBy: { order: 'asc' } } },
    });
    if (!route) throw new NotFoundException('Route not found');

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const [riders, scans] = await Promise.all([
      this.db.transportRider.findMany({
        where: { schoolId: auth.schoolId, routeId },
        include: {
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              admissionNo: true,
              status: true,
              classRoom: { select: { name: true } },
              guardians: {
                where: { isPrimary: true },
                select: { guardian: { select: { phone: true } } },
              },
            },
          },
          stop: { select: { name: true } },
        },
      }),
      this.db.transportScan.findMany({
        where: { schoolId: auth.schoolId, routeId, scannedAt: { gte: dayStart } },
        orderBy: { scannedAt: 'desc' },
      }),
    ]);

    const lastScan = new Map<string, { direction: string; at: Date }>();
    for (const s of scans) {
      if (!lastScan.has(s.studentId)) {
        lastScan.set(s.studentId, { direction: s.direction, at: s.scannedAt });
      }
    }

    return {
      route: { id: route.id, name: route.name },
      riders: riders
        .filter((r) => r.student.status === 'ACTIVE')
        .map((r) => ({
          studentId: r.student.id,
          name: `${r.student.firstName} ${r.student.lastName}`,
          admissionNo: r.student.admissionNo,
          className: r.student.classRoom?.name ?? null,
          stop: r.stop?.name ?? null,
          guardianPhone: r.student.guardians[0]?.guardian.phone ?? null,
          today: lastScan.get(r.student.id) ?? null,
        }))
        .sort((a, b) => (a.stop ?? '').localeCompare(b.stop ?? '') || a.name.localeCompare(b.name)),
    };
  }

  // ── Scans ──────────────────────────────────────────────────────────

  async scan(auth: AuthUser, dto: ScanDto) {
    // Replay first — the device only retries because it never saw our answer.
    if (dto.clientRef) {
      const existing = await this.db.transportScan.findFirst({
        where: { schoolId: auth.schoolId, clientRef: dto.clientRef },
      });
      if (existing) return { ok: true, replayed: true, at: existing.scannedAt };
    }

    const student = dto.studentId
      ? await this.db.student.findFirst({
          where: { id: dto.studentId, schoolId: auth.schoolId },
        })
      : dto.admissionNo
        ? await this.db.student.findFirst({
            where: { admissionNo: dto.admissionNo.trim(), schoolId: auth.schoolId },
          })
        : null;
    if (!student) throw new NotFoundException('No child matches that scan');

    const route = await this.db.transportRoute.findFirst({
      where: { id: dto.routeId, schoolId: auth.schoolId },
    });
    if (!route) throw new NotFoundException('Route not found');

    // A child off the manifest still gets recorded — the bus is not the place to refuse a
    // child a seat — but the response says so, so the operator can flag it.
    const onManifest = await this.db.transportRider.findFirst({
      where: { schoolId: auth.schoolId, studentId: student.id, routeId: route.id },
    });

    const scan = await this.db.transportScan.create({
      data: {
        schoolId: auth.schoolId,
        studentId: student.id,
        routeId: route.id,
        direction: dto.direction,
        recordedById: auth.sub,
        clientRef: dto.clientRef ?? null,
      },
    });
    return {
      ok: true,
      student: `${student.firstName} ${student.lastName}`,
      direction: dto.direction,
      onManifest: !!onManifest,
      at: scan.scannedAt,
    };
  }

  /** The day's scans for one route, newest first. */
  async scans(auth: AuthUser, routeId: string, date?: string) {
    const from = date ? new Date(date) : new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    const rows = await this.db.transportScan.findMany({
      where: { schoolId: auth.schoolId, routeId, scannedAt: { gte: from, lt: to } },
      include: {
        student: { select: { firstName: true, lastName: true, admissionNo: true } },
      },
      orderBy: { scannedAt: 'desc' },
    });
    return rows.map((s) => ({
      id: s.id,
      student: `${s.student.firstName} ${s.student.lastName}`,
      admissionNo: s.student.admissionNo,
      direction: s.direction,
      scannedAt: s.scannedAt,
    }));
  }
}

@Controller('transport')
@RequireEntitlement('safety.transport')
export class TransportController {
  constructor(private svc: TransportService) {}

  @Get('routes')
  @RequireAnyPermission('transport.operate', 'transport.manage')
  routes(@CurrentUser() user: AuthUser) {
    return this.svc.routes(user);
  }

  @Post('routes')
  @RequirePermission('transport.manage')
  createRoute(@CurrentUser() user: AuthUser, @Body() dto: RouteDto) {
    return this.svc.createRoute(user, dto);
  }

  @Patch('routes/:id')
  @RequirePermission('transport.manage')
  updateRoute(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: Partial<RouteDto>,
  ) {
    return this.svc.updateRoute(user, id, dto);
  }

  @Delete('routes/:id')
  @RequirePermission('transport.manage')
  deleteRoute(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteRoute(user, id);
  }

  @Post('routes/:id/stops')
  @RequirePermission('transport.manage')
  addStop(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: StopDto) {
    return this.svc.addStop(user, id, dto);
  }

  @Delete('stops/:id')
  @RequirePermission('transport.manage')
  deleteStop(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteStop(user, id);
  }

  @Post('routes/:id/riders')
  @RequirePermission('transport.manage')
  assignRider(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RiderDto) {
    return this.svc.assignRider(user, id, dto);
  }

  @Delete('riders/:studentId')
  @RequirePermission('transport.manage')
  removeRider(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    return this.svc.removeRider(user, studentId);
  }

  @Get('routes/:id/manifest')
  @RequireAnyPermission('transport.operate', 'transport.manage')
  manifest(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.manifest(user, id);
  }

  @Post('scan')
  @RequirePermission('transport.operate')
  scan(@CurrentUser() user: AuthUser, @Body() dto: ScanDto) {
    return this.svc.scan(user, dto);
  }

  @Get('routes/:id/scans')
  @RequireAnyPermission('transport.operate', 'transport.manage')
  scans(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('date') date?: string) {
    return this.svc.scans(user, id, date);
  }
}

@Module({
  controllers: [TransportController],
  providers: [TransportService],
})
export class TransportModule {}
