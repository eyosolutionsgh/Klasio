/**
 * Boarding / hostel (housing.boarding).
 *
 * The three things a boarding school keeps on paper: which houses and rooms exist, who sleeps in
 * which bed, and the exeat book — a boarder signed out for the weekend or the sick bay, and later
 * signed back in. Following the transport module, these tables carry a scalar schoolId and refer
 * to students and the warden by id; the child's name is looked up when shown, so the hot Student
 * model gains no boarding relation.
 *
 * One bed per boarder is a database invariant (BoardingAssignment.studentId is unique), so moving
 * a child between rooms is an upsert, never a chance to leave them in two beds at once.
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
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthUser,
  CurrentUser,
  RequireAnyPermission,
  RequireEntitlement,
  RequirePermission,
} from '../common/auth';

const KINDS = ['BOYS', 'GIRLS', 'MIXED'] as const;
type Kind = (typeof KINDS)[number];

class HouseDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsOptional() @IsIn(KINDS) kind?: Kind;
  /** The house master or matron. Empty string clears it. */
  @IsOptional() @IsString() wardenId?: string;
}

class RoomDto {
  @IsString() @MinLength(1) @MaxLength(60) name: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
}

class AssignDto {
  @IsOptional() @IsString() studentId?: string;
  @IsOptional() @IsString() admissionNo?: string;
}

class ExeatDto {
  @IsOptional() @IsString() studentId?: string;
  @IsOptional() @IsString() admissionNo?: string;
  @IsString() @MinLength(2) @MaxLength(200) reason: string;
  @IsOptional() @IsString() @MaxLength(200) destination?: string;
  @IsDateString() dueBackAt: string;
}

@Injectable()
export class HousingService {
  constructor(private db: PrismaService) {}

  private name(s: { firstName: string; lastName: string }) {
    return `${s.firstName} ${s.lastName}`;
  }

  /** The whole boarding picture for one screen: houses, their rooms and beds, and who is in them. */
  async overview(auth: AuthUser) {
    const houses = await this.db.hostel.findMany({
      where: { schoolId: auth.schoolId },
      include: {
        rooms: {
          orderBy: { name: 'asc' },
          include: { _count: { select: { assignments: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    const [assignments, wardens] = await Promise.all([
      this.db.boardingAssignment.findMany({
        where: { schoolId: auth.schoolId },
      }),
      this.db.user.findMany({
        where: { schoolId: auth.schoolId, id: { in: houses.map((h) => h.wardenId ?? '') } },
        select: { id: true, name: true },
      }),
    ]);
    const wardenName = new Map(wardens.map((w) => [w.id, w.name]));

    const students = await this.db.student.findMany({
      where: { schoolId: auth.schoolId, id: { in: assignments.map((a) => a.studentId) } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
        classRoom: { select: { name: true } },
      },
    });
    const boarderById = new Map(students.map((s) => [s.id, s]));
    const boardersByRoom = new Map<string, typeof students>();
    for (const a of assignments) {
      const s = boarderById.get(a.studentId);
      if (!s) continue;
      const list = boardersByRoom.get(a.roomId) ?? [];
      list.push(s);
      boardersByRoom.set(a.roomId, list);
    }

    const capacity = houses.reduce(
      (sum, h) => sum + h.rooms.reduce((r, room) => r + room.capacity, 0),
      0,
    );

    return {
      stats: { houses: houses.length, boarders: assignments.length, beds: capacity },
      houses: houses.map((h) => ({
        id: h.id,
        name: h.name,
        kind: h.kind,
        wardenId: h.wardenId,
        warden: h.wardenId ? (wardenName.get(h.wardenId) ?? null) : null,
        rooms: h.rooms.map((room) => ({
          id: room.id,
          name: room.name,
          capacity: room.capacity,
          occupied: room._count.assignments,
          boarders: (boardersByRoom.get(room.id) ?? [])
            .map((s) => ({
              studentId: s.id,
              name: this.name(s),
              admissionNo: s.admissionNo,
              className: s.classRoom?.name ?? null,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        })),
      })),
    };
  }

  private async resolveWarden(auth: AuthUser, wardenId?: string): Promise<string | null> {
    if (!wardenId) return null;
    const u = await this.db.user.findFirst({ where: { id: wardenId, schoolId: auth.schoolId } });
    if (!u) throw new NotFoundException('That member of staff was not found');
    return u.id;
  }

  async createHouse(auth: AuthUser, dto: HouseDto) {
    const house = await this.db.hostel.create({
      data: {
        schoolId: auth.schoolId,
        name: dto.name.trim(),
        kind: dto.kind ?? 'MIXED',
        wardenId: await this.resolveWarden(auth, dto.wardenId),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'housing.house.create', 'Hostel', house.id, {
      name: house.name,
    });
    return house;
  }

  async updateHouse(auth: AuthUser, id: string, dto: Partial<HouseDto>) {
    const existing = await this.db.hostel.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!existing) throw new NotFoundException('House not found');
    return this.db.hostel.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.wardenId !== undefined
          ? { wardenId: await this.resolveWarden(auth, dto.wardenId || undefined) }
          : {}),
      },
    });
  }

  async deleteHouse(auth: AuthUser, id: string) {
    const house = await this.db.hostel.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: { rooms: { include: { _count: { select: { assignments: true } } } } },
    });
    if (!house) throw new NotFoundException('House not found');
    const boarders = house.rooms.reduce((n, r) => n + r._count.assignments, 0);
    if (boarders > 0) {
      throw new BadRequestException(
        `${boarders} boarder${boarders === 1 ? '' : 's'} still sleep here. Move them first.`,
      );
    }
    await this.db.hostel.delete({ where: { id } });
    await this.db.audit(auth.schoolId, auth.sub, 'housing.house.delete', 'Hostel', id, {
      name: house.name,
    });
    return { deleted: true };
  }

  async addRoom(auth: AuthUser, houseId: string, dto: RoomDto) {
    const house = await this.db.hostel.findFirst({
      where: { id: houseId, schoolId: auth.schoolId },
    });
    if (!house) throw new NotFoundException('House not found');
    return this.db.hostelRoom.create({
      data: {
        schoolId: auth.schoolId,
        hostelId: houseId,
        name: dto.name.trim(),
        capacity: dto.capacity ?? 1,
      },
    });
  }

  async deleteRoom(auth: AuthUser, id: string) {
    const room = await this.db.hostelRoom.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: { _count: { select: { assignments: true } } },
    });
    if (!room) throw new NotFoundException('Room not found');
    if (room._count.assignments > 0) {
      throw new BadRequestException('Boarders still sleep in this room. Move them first.');
    }
    await this.db.hostelRoom.delete({ where: { id } });
    return { deleted: true };
  }

  private async findStudent(auth: AuthUser, studentId?: string, admissionNo?: string) {
    const student = studentId
      ? await this.db.student.findFirst({ where: { id: studentId, schoolId: auth.schoolId } })
      : admissionNo
        ? await this.db.student.findFirst({
            where: { admissionNo: admissionNo.trim(), schoolId: auth.schoolId },
          })
        : null;
    if (!student) throw new NotFoundException('Student not found');
    if (student.status !== 'ACTIVE') {
      throw new BadRequestException('Only an enrolled student can be given a bed');
    }
    return student;
  }

  /** Put a boarder in a bed. One bed per child, so a second assignment moves them. */
  async assign(auth: AuthUser, roomId: string, dto: AssignDto) {
    const room = await this.db.hostelRoom.findFirst({
      where: { id: roomId, schoolId: auth.schoolId },
      include: { _count: { select: { assignments: true } } },
    });
    if (!room) throw new NotFoundException('Room not found');
    const student = await this.findStudent(auth, dto.studentId, dto.admissionNo);

    const current = await this.db.boardingAssignment.findUnique({
      where: { studentId: student.id },
    });
    // A move within the same room is a no-op, not a capacity breach.
    const movingIn = current?.roomId !== room.id;
    if (movingIn && room._count.assignments >= room.capacity) {
      throw new BadRequestException(
        `${room.name} is full (${room.capacity} bed${room.capacity === 1 ? '' : 's'}).`,
      );
    }

    await this.db.boardingAssignment.upsert({
      where: { studentId: student.id },
      create: { schoolId: auth.schoolId, studentId: student.id, roomId: room.id },
      update: { roomId: room.id },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'housing.assign', 'Student', student.id, {
      roomId: room.id,
    });
    return { ok: true };
  }

  async unassign(auth: AuthUser, studentId: string) {
    const existing = await this.db.boardingAssignment.findFirst({
      where: { studentId, schoolId: auth.schoolId },
    });
    if (!existing) throw new NotFoundException('That child is not a boarder');
    await this.db.boardingAssignment.delete({ where: { id: existing.id } });
    await this.db.audit(auth.schoolId, auth.sub, 'housing.unassign', 'Student', studentId);
    return { ok: true };
  }

  /** Active students who could be given a bed — those not already boarding. */
  async candidates(auth: AuthUser, q?: string) {
    const boarders = await this.db.boardingAssignment.findMany({
      where: { schoolId: auth.schoolId },
      select: { studentId: true },
    });
    const term = (q ?? '').trim();
    const students = await this.db.student.findMany({
      where: {
        schoolId: auth.schoolId,
        status: 'ACTIVE',
        id: { notIn: boarders.map((b) => b.studentId) },
        ...(term
          ? {
              OR: [
                { firstName: { contains: term, mode: 'insensitive' } },
                { lastName: { contains: term, mode: 'insensitive' } },
                { admissionNo: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
        classRoom: { select: { name: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 20,
    });
    return students.map((s) => ({
      studentId: s.id,
      name: this.name(s),
      admissionNo: s.admissionNo,
      className: s.classRoom?.name ?? null,
    }));
  }

  // ── Exeats ─────────────────────────────────────────────────────────

  async exeats(auth: AuthUser) {
    const rows = await this.db.exeat.findMany({
      where: { schoolId: auth.schoolId },
      orderBy: [{ returnedAt: 'asc' }, { outAt: 'desc' }],
      take: 100,
    });
    const students = await this.db.student.findMany({
      where: { schoolId: auth.schoolId, id: { in: rows.map((r) => r.studentId) } },
      select: { id: true, firstName: true, lastName: true, admissionNo: true },
    });
    const byId = new Map(students.map((s) => [s.id, s]));
    return rows.map((r) => {
      const s = byId.get(r.studentId);
      return {
        id: r.id,
        studentId: r.studentId,
        name: s ? this.name(s) : 'Unknown',
        admissionNo: s?.admissionNo ?? null,
        reason: r.reason,
        destination: r.destination,
        outAt: r.outAt,
        dueBackAt: r.dueBackAt,
        returnedAt: r.returnedAt,
        overdue: !r.returnedAt && r.dueBackAt < new Date(),
      };
    });
  }

  async signOut(auth: AuthUser, dto: ExeatDto) {
    const student = await this.findStudent(auth, dto.studentId, dto.admissionNo);
    const boarding = await this.db.boardingAssignment.findUnique({
      where: { studentId: student.id },
    });
    if (!boarding) {
      throw new BadRequestException('Only a boarder can be signed out on an exeat');
    }
    const dueBack = new Date(dto.dueBackAt);
    if (Number.isNaN(dueBack.getTime())) throw new BadRequestException('A return date is required');
    const exeat = await this.db.exeat.create({
      data: {
        schoolId: auth.schoolId,
        studentId: student.id,
        reason: dto.reason.trim(),
        destination: dto.destination?.trim() || null,
        dueBackAt: dueBack,
        approvedById: auth.sub,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'housing.exeat.out', 'Student', student.id, {
      exeatId: exeat.id,
    });
    return exeat;
  }

  async signIn(auth: AuthUser, id: string) {
    const exeat = await this.db.exeat.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!exeat) throw new NotFoundException('Exeat not found');
    if (exeat.returnedAt) throw new BadRequestException('Already signed back in');
    const updated = await this.db.exeat.update({
      where: { id },
      data: { returnedAt: new Date() },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'housing.exeat.in', 'Student', exeat.studentId, {
      exeatId: id,
    });
    return updated;
  }
}

@Controller('housing')
@RequireEntitlement('housing.boarding')
export class HousingController {
  constructor(private svc: HousingService) {}

  @Get()
  @RequireAnyPermission('housing.view', 'housing.manage')
  overview(@CurrentUser() user: AuthUser) {
    return this.svc.overview(user);
  }

  @Get('candidates')
  @RequirePermission('housing.manage')
  candidates(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    return this.svc.candidates(user, q);
  }

  @Post('houses')
  @RequirePermission('housing.manage')
  createHouse(@CurrentUser() user: AuthUser, @Body() dto: HouseDto) {
    return this.svc.createHouse(user, dto);
  }

  @Patch('houses/:id')
  @RequirePermission('housing.manage')
  updateHouse(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: Partial<HouseDto>,
  ) {
    return this.svc.updateHouse(user, id, dto);
  }

  @Delete('houses/:id')
  @RequirePermission('housing.manage')
  deleteHouse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteHouse(user, id);
  }

  @Post('houses/:id/rooms')
  @RequirePermission('housing.manage')
  addRoom(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RoomDto) {
    return this.svc.addRoom(user, id, dto);
  }

  @Delete('rooms/:id')
  @RequirePermission('housing.manage')
  deleteRoom(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteRoom(user, id);
  }

  @Post('rooms/:id/assign')
  @RequirePermission('housing.manage')
  assign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AssignDto) {
    return this.svc.assign(user, id, dto);
  }

  @Delete('boarders/:studentId')
  @RequirePermission('housing.manage')
  unassign(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    return this.svc.unassign(user, studentId);
  }

  @Get('exeats')
  @RequireAnyPermission('housing.view', 'housing.manage')
  exeats(@CurrentUser() user: AuthUser) {
    return this.svc.exeats(user);
  }

  @Post('exeats')
  @RequirePermission('housing.manage')
  signOut(@CurrentUser() user: AuthUser, @Body() dto: ExeatDto) {
    return this.svc.signOut(user, dto);
  }

  @Post('exeats/:id/return')
  @RequirePermission('housing.manage')
  signIn(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.signIn(user, id);
  }
}

@Module({
  controllers: [HousingController],
  providers: [HousingService],
})
export class HousingModule {}
