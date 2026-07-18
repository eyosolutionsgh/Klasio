import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/auth';
import { canGrant, PERMISSIONS, ROLE_PRESETS, sanitizePermissions } from '../common/permissions';

/**
 * Roles, as the school defines them.
 *
 * Every school gets the presets on day one and can rename, re-scope, extend or delete any of
 * them. What a school may NOT do is invent a permission: the codes are defined in
 * common/permissions.ts because feature code references them, so a made-up one would guard
 * nothing.
 *
 * The rule that makes the rest safe is that **nobody can hand out authority they do not hold**.
 * Without it, anyone with `users.manage` could build a role containing `fees.record_payment`,
 * assign it to themselves and quietly become a cashier.
 */

class RoleDto {
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsString() description?: string;
  @IsArray() permissions: string[];
}

class AssignDto {
  /** Null clears the role, leaving the person with nothing but their personal grants. */
  @IsOptional() @IsString() staffRoleId?: string | null;
  @IsOptional() @IsArray() extraPermissions?: string[];
  @IsOptional() @IsArray() revokedPermissions?: string[];
}

@Injectable()
export class RolesService {
  constructor(private db: PrismaService) {}

  /** The catalogue the role editor renders: every permission, grouped, with its cautions. */
  catalogue() {
    return {
      permissions: PERMISSIONS,
      groups: [...new Set(PERMISSIONS.map((p) => p.group))],
    };
  }

  async list(auth: AuthUser) {
    const roles = await this.db.staffRole.findMany({
      where: { schoolId: auth.schoolId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true } } },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      permissions: r.permissions,
      presetKey: r.presetKey,
      staffCount: r._count.users,
    }));
  }

  /**
   * Restore any presets a school has deleted or never had.
   *
   * Additive by design: a school that renamed "Bursar" to "Accountant" keeps its version, because
   * the conflict is on name and the insert is skipped. This exists so a school that deleted a
   * role by mistake is not stuck rebuilding it permission by permission.
   */
  async restorePresets(auth: AuthUser) {
    const existing = await this.db.staffRole.findMany({
      where: { schoolId: auth.schoolId },
      select: { name: true, presetKey: true },
    });
    const haveKey = new Set(existing.map((r) => r.presetKey).filter(Boolean));
    const haveName = new Set(existing.map((r) => r.name));

    const missing = ROLE_PRESETS.filter((p) => !haveKey.has(p.key) && !haveName.has(p.name));
    for (const p of missing) {
      await this.db.staffRole.create({
        data: {
          schoolId: auth.schoolId,
          name: p.name,
          description: p.description,
          permissions: sanitizePermissions(p.permissions),
          presetKey: p.key,
        },
      });
    }
    await this.db.audit(auth.schoolId, auth.sub, 'roles.restore-presets', 'StaffRole', undefined, {
      restored: missing.map((m) => m.name),
    });
    return { restored: missing.length };
  }

  /** Refuses anything the caller does not hold themselves. */
  private assertCanGrant(auth: AuthUser, codes: string[]) {
    const over = canGrant(auth.permissions ?? [], codes);
    if (over.length > 0) {
      const label = PERMISSIONS.find((p) => p.code === over[0])?.label ?? over[0];
      throw new ForbiddenException(
        `You cannot grant "${label}" because you do not have it yourself` +
          (over.length > 1 ? ` (and ${over.length - 1} more)` : ''),
      );
    }
  }

  async create(auth: AuthUser, dto: RoleDto) {
    const permissions = sanitizePermissions(dto.permissions);
    if (permissions.length === 0) {
      throw new BadRequestException('Choose at least one thing this role may do');
    }
    this.assertCanGrant(auth, permissions);

    const clash = await this.db.staffRole.findFirst({
      where: { schoolId: auth.schoolId, name: dto.name.trim() },
    });
    if (clash) throw new BadRequestException(`There is already a role called "${dto.name.trim()}"`);

    const role = await this.db.staffRole.create({
      data: {
        schoolId: auth.schoolId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        permissions,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'roles.create', 'StaffRole', role.id, {
      name: role.name,
      permissions,
    });
    return role;
  }

  async update(auth: AuthUser, id: string, dto: RoleDto) {
    const role = await this.db.staffRole.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!role) throw new NotFoundException('Role not found');

    const permissions = sanitizePermissions(dto.permissions);
    if (permissions.length === 0) {
      throw new BadRequestException('Choose at least one thing this role may do');
    }
    // Only the *added* permissions need to be within the caller's own authority. Taking one away
    // is always allowed, or a head could never narrow a role they do not fully hold.
    const added = permissions.filter((p) => !role.permissions.includes(p));
    this.assertCanGrant(auth, added);

    const updated = await this.db.staffRole.update({
      where: { id },
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        permissions,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'roles.update', 'StaffRole', id, {
      name: updated.name,
      added,
      removed: role.permissions.filter((p) => !permissions.includes(p)),
    });
    return updated;
  }

  async remove(auth: AuthUser, id: string) {
    const role = await this.db.staffRole.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    if (role._count.users > 0) {
      // Deleting would silently strip those people back to nothing. Make the school move them
      // first, so the loss of access is a decision rather than a side effect.
      throw new BadRequestException(
        `${role._count.users} ${role._count.users === 1 ? 'person holds' : 'people hold'} this role. Move them to another role first.`,
      );
    }
    await this.db.staffRole.delete({ where: { id } });
    await this.db.audit(auth.schoolId, auth.sub, 'roles.delete', 'StaffRole', id, {
      name: role.name,
    });
    return { deleted: true };
  }

  /**
   * Put someone on a role, and adjust it for them personally.
   *
   * The proprietor is refused outright: their authority is unconditional by design, and a role
   * assigned to them would be a way to narrow it — the one change that could lock a school out
   * of itself with nobody able to undo it.
   */
  async assign(auth: AuthUser, userId: string, dto: AssignDto) {
    const target = await this.db.user.findFirst({
      where: { id: userId, schoolId: auth.schoolId },
      select: { id: true, name: true, role: true },
    });
    if (!target) throw new NotFoundException('That account is not in this school');
    if (target.role === 'OWNER') {
      throw new BadRequestException(
        'The proprietor always has full access. Nothing here can narrow it.',
      );
    }

    let roleName: string | null = null;
    if (dto.staffRoleId) {
      const role = await this.db.staffRole.findFirst({
        where: { id: dto.staffRoleId, schoolId: auth.schoolId },
      });
      if (!role) throw new NotFoundException('Role not found');
      // Assigning a role hands over everything in it, so the same rule applies.
      this.assertCanGrant(auth, role.permissions);
      roleName = role.name;
    }

    const extra = sanitizePermissions(dto.extraPermissions ?? []);
    this.assertCanGrant(auth, extra);
    const revoked = sanitizePermissions(dto.revokedPermissions ?? []);

    await this.db.user.update({
      where: { id: userId },
      data: {
        ...(dto.staffRoleId !== undefined ? { staffRoleId: dto.staffRoleId || null } : {}),
        ...(dto.extraPermissions !== undefined ? { extraPermissions: extra } : {}),
        ...(dto.revokedPermissions !== undefined ? { revokedPermissions: revoked } : {}),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'roles.assign', 'User', userId, {
      staff: target.name,
      role: roleName,
      extraPermissions: extra,
      revokedPermissions: revoked,
    });
    return { ok: true };
  }
}

@Controller('roles')
export class RolesController {
  constructor(private svc: RolesService) {}

  /** Open to anyone who may see staff, so the users screen can label who holds what. */
  @Get()
  @RequirePermission('users.view')
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user);
  }

  @Get('catalogue')
  @RequirePermission('roles.manage')
  catalogue() {
    return this.svc.catalogue();
  }

  /** What the caller themselves holds — the editor greys out what they cannot pass on. */
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return { role: user.role, permissions: user.permissions ?? [] };
  }

  @Post()
  @RequirePermission('roles.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: RoleDto) {
    return this.svc.create(user, dto);
  }

  @Post('restore-presets')
  @RequirePermission('roles.manage')
  restore(@CurrentUser() user: AuthUser) {
    return this.svc.restorePresets(user);
  }

  @Patch(':id')
  @RequirePermission('roles.manage')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RoleDto) {
    return this.svc.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermission('roles.manage')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }

  @Post('assign/:userId')
  @RequirePermission('users.manage')
  assign(@CurrentUser() user: AuthUser, @Param('userId') userId: string, @Body() dto: AssignDto) {
    return this.svc.assign(user, userId, dto);
  }
}

@Module({ controllers: [RolesController], providers: [RolesService] })
export class RolesModule {}
