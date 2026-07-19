import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { canGrant } from '../common/permissions';
import { AuthUser, CurrentUser, RequirePermission } from '../common/auth';
import { canAssignRole, canManageUser, STAFF_ROLES } from '../common/roles';
import { BCRYPT_ROUNDS } from '../common/crypto';

class CreateUserDto {
  @IsString() @MinLength(2) name: string;
  @IsEmail() email: string;
  /**
   * Legacy coarse role. Still recorded because OWNER is special — the proprietor's authority is
   * unconditional — and because guardians and students are principals of another kind entirely.
   * What the person may actually do comes from `staffRoleId`.
   */
  @IsIn(STAFF_ROLES) role: Role;
  /** The school-defined role. Without one the account can sign in and do nothing. */
  @IsOptional() @IsString() staffRoleId?: string;
  @IsOptional() @IsString() phone?: string;
  /** Omit to have a temporary password generated and returned once. */
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsIn(STAFF_ROLES) role?: Role;
  @IsOptional() @IsString() staffRoleId?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** Self-service: what a signed-in member may change about their own account. */
class UpdateMeDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() phone?: string;
}

class ChangePasswordDto {
  @IsString() currentPassword: string;
  @IsString() @MinLength(8) newPassword: string;
}

/** Readable one-time password an office can dictate over the phone. */
function tempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes
  const bytes = randomBytes(8);
  const body = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `Eyo-${body}`;
}

@Injectable()
export class UsersService {
  constructor(private db: PrismaService) {}

  async list(auth: AuthUser, includeInactive = false) {
    const users = await this.db.user.findMany({
      where: {
        schoolId: auth.schoolId,
        role: { in: STAFF_ROLES },
        ...(includeInactive ? {} : { active: true }),
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        // The admin screen needs to READ these, not just write them: an access panel that
        // cannot see the current adjustments would replace them blind on every save.
        staffRoleId: true,
        staffRole: { select: { id: true, name: true } },
        extraPermissions: true,
        revokedPermissions: true,
        email: true,
        phone: true,
        role: true,
        active: true,
        createdAt: true,
      },
    });
    // Flag what the caller may act on, so the UI can hide controls the API would refuse.
    //
    // This has to key off the PERMISSION the routes actually require, not the legacy coarse
    // role. Deriving it from the role is how a head ended up seeing "Reset password" and
    // "Deactivate" buttons that 403 the moment they are clicked — the exact class of bug the
    // permission model exists to remove.
    const mayManage = auth.permissions?.includes('users.manage') ?? false;
    return users.map((u) => ({
      ...u,
      manageable: mayManage && canManageUser(auth.role, u.role) && u.id !== auth.sub,
      isSelf: u.id === auth.sub,
    }));
  }

  /**
   * Refuse to hand someone a role containing more than the caller holds.
   *
   * Without this, anyone with `users.manage` could create an account on the Bursar role, sign in
   * as it, and hold permissions they were never granted — which would make every separation in
   * the permission model decorative.
   */
  private async assertMayAssign(auth: AuthUser, staffRoleId: string) {
    const role = await this.db.staffRole.findFirst({
      where: { id: staffRoleId, schoolId: auth.schoolId },
    });
    if (!role) throw new NotFoundException('Role not found');
    const over = canGrant(auth.permissions ?? [], role.permissions);
    if (over.length > 0) {
      throw new ForbiddenException(
        `You cannot put someone on "${role.name}" because it includes access you do not have yourself`,
      );
    }
  }

  async create(auth: AuthUser, dto: CreateUserDto) {
    if (!canAssignRole(auth.role, dto.role)) {
      throw new ForbiddenException(
        `You cannot create a ${dto.role.toLowerCase().replace('_', ' ')} account`,
      );
    }
    // Assigning a role hands over everything in it, so the same rule as the role editor applies:
    // you cannot give away authority you do not hold yourself.
    if (dto.staffRoleId) await this.assertMayAssign(auth, dto.staffRoleId);

    const plain = dto.password ?? tempPassword();
    const email = dto.email.toLowerCase().trim();

    try {
      const user = await this.db.user.create({
        data: {
          staffRoleId: dto.staffRoleId ?? null,
          schoolId: auth.schoolId,
          name: dto.name,
          email,
          phone: dto.phone ?? null,
          role: dto.role,
          passwordHash: await bcrypt.hash(plain, BCRYPT_ROUNDS),
        },
        select: { id: true, name: true, email: true, role: true, active: true },
      });
      await this.db.audit(auth.schoolId, auth.sub, 'user.create', 'User', user.id, {
        email,
        role: dto.role,
      });
      // The one and only time the password is visible; it is stored hashed.
      return { ...user, temporaryPassword: dto.password ? undefined : plain };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException(`${email} is already in use`);
      }
      throw e;
    }
  }

  private async loadTarget(auth: AuthUser, id: string) {
    const user = await this.db.user.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!user) throw new NotFoundException('User not found');
    if (!canManageUser(auth.role, user.role)) {
      throw new ForbiddenException('You cannot manage an account above your own role');
    }
    return user;
  }

  /** Refuse anything that would leave the school with no active owner. */
  private async assertNotLastOwner(auth: AuthUser, target: { id: string; role: Role }) {
    if (target.role !== 'OWNER') return;
    const owners = await this.db.user.count({
      where: { schoolId: auth.schoolId, role: 'OWNER', active: true, id: { not: target.id } },
    });
    if (owners === 0) {
      throw new BadRequestException(
        'This is the last active owner — promote another owner first, or the school would be locked out',
      );
    }
  }

  async update(auth: AuthUser, id: string, dto: UpdateUserDto) {
    const target = await this.loadTarget(auth, id);
    if (dto.staffRoleId) await this.assertMayAssign(auth, dto.staffRoleId);

    // Self-protection: changing your own role or switching yourself off is how admins
    // accidentally lock themselves out.
    if (target.id === auth.sub && (dto.role !== undefined || dto.active === false)) {
      throw new BadRequestException('You cannot change your own role or deactivate yourself');
    }
    if (dto.role !== undefined && !canAssignRole(auth.role, dto.role)) {
      throw new ForbiddenException('You cannot grant a role above your own');
    }
    if (dto.role !== undefined && dto.role !== target.role) {
      await this.assertNotLastOwner(auth, target);
    }
    if (dto.active === false) {
      await this.assertNotLastOwner(auth, target);
    }

    const user = await this.db.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone || null } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        // An explicit null clears the role, leaving the account able to sign in and do nothing —
        // which is a legitimate way to suspend access without deactivating the person.
        ...(dto.staffRoleId !== undefined ? { staffRoleId: dto.staffRoleId || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
      select: { id: true, name: true, email: true, phone: true, role: true, active: true },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'user.update', 'User', id, dto as object);
    return user;
  }

  /** Issue a fresh temporary password — returned once, stored hashed. */
  async resetPassword(auth: AuthUser, id: string) {
    const target = await this.loadTarget(auth, id);
    const plain = tempPassword();
    await this.db.user.update({
      where: { id: target.id },
      data: { passwordHash: await bcrypt.hash(plain, BCRYPT_ROUNDS) },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'user.resetPassword', 'User', id);
    return { id: target.id, email: target.email, temporaryPassword: plain };
  }

  /** The signed-in member's own account — no role check, everyone owns their own profile. */
  async me(auth: AuthUser) {
    const u = await this.db.user.findFirst({
      where: { id: auth.sub, schoolId: auth.schoolId },
      select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true },
    });
    if (!u) throw new NotFoundException('Account not found');
    return u;
  }

  async updateMe(auth: AuthUser, dto: UpdateMeDto) {
    await this.db.user.update({
      where: { id: auth.sub },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'user.self.update', 'User', auth.sub, dto);
    return this.me(auth);
  }

  /**
   * Changing your own password requires proving you know the current one, so a walked-away-from
   * session cannot be turned into a permanent takeover.
   */
  async changePassword(auth: AuthUser, dto: ChangePasswordDto) {
    const u = await this.db.user.findUnique({ where: { id: auth.sub } });
    if (!u) throw new NotFoundException('Account not found');
    if (!(await bcrypt.compare(dto.currentPassword, u.passwordHash))) {
      throw new BadRequestException('That is not your current password');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('The new password must be different');
    }
    await this.db.user.update({
      where: { id: auth.sub },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS) },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'user.self.password', 'User', auth.sub);
    return { ok: true };
  }
}

@Controller('users')
export class UsersController {
  constructor(private svc: UsersService) {}

  @Get()
  @RequirePermission('users.view')
  list(@CurrentUser() user: AuthUser, @Query('includeInactive') includeInactive?: string) {
    return this.svc.list(user, includeInactive === 'true');
  }

  // Declared before the ':id' routes — otherwise 'me' matches those and a teacher editing their
  // own profile is refused by the OWNER/HEAD guard on them.
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.svc.me(user);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.svc.updateMe(user, dto);
  }

  @Post('me/password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.svc.changePassword(user, dto);
  }

  @Post()
  @RequirePermission('users.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    return this.svc.create(user, dto);
  }

  @Patch(':id')
  @RequirePermission('users.manage')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.svc.update(user, id, dto);
  }

  @Post(':id/reset-password')
  @RequirePermission('users.manage')
  resetPassword(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.resetPassword(user, id);
  }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
