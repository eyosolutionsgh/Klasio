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
import { PrismaService } from '../prisma/prisma.service';
import { canGrant, isDelegate } from '../common/permissions';
import { AuthModule, AuthService } from '../auth/auth.module';
import { AuthUser, CurrentUser, RequirePermission } from '../common/auth';
import { canAssignRole, canManageUser, DEFAULT_STAFF_ROLE, STAFF_ROLES } from '../common/roles';
import { BCRYPT_ROUNDS, tempPassword } from '../common/crypto';

class CreateUserDto {
  @IsString() @MinLength(2) name: string;
  @IsEmail() email: string;
  /**
   * What kind of principal this is, and no longer what job they do — that is `staffRoleId`.
   *
   * Optional, and normally omitted: a new account is simply staff. It is still accepted so a
   * proprietor can create a co-proprietor, which is the one value that confers anything.
   */
  @IsOptional() @IsIn(STAFF_ROLES) role?: Role;
  /** The school-defined role. Without one the account can sign in and do nothing. */
  @IsOptional() @IsString() staffRoleId?: string;
  @IsOptional() @IsString() phone?: string;
  /** Omit to have a temporary password generated and returned once. */
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() phone?: string;
  /** In practice only ever OWNER: making, or standing down, a co-proprietor. */
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

/** Which way a reset reaches the account holder. Email always exists; SMS needs a number on file. */
class ResetPasswordDto {
  @IsOptional() @IsIn(['email', 'sms']) channel?: 'email' | 'sms';
}

@Injectable()
export class UsersService {
  constructor(
    private db: PrismaService,
    private auth: AuthService,
  ) {}

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
      manageable: mayManage && canManageUser(auth, u.role) && u.id !== auth.sub,
      isSelf: u.id === auth.sub,
    }));
  }

  /**
   * Refuse to hand someone a role containing more than the caller holds.
   *
   * Without this, anyone with `users.manage` could create an account on the Bursar role, sign in
   * as it, and hold permissions they were never granted — which would make every separation in
   * the permission model decorative.
   *
   * Unless the caller administers access on the school's behalf (`users.delegate`), which is the
   * whole of that job: staffing the bursar's desk means granting money permissions to somebody
   * else. Returns what was handed over beyond the caller's own reach, so the audit row can name
   * it — a delegate is answerable for over-granting, and that is only true if it is written down.
   */
  private async assertMayAssign(auth: AuthUser, staffRoleId: string): Promise<string[]> {
    const role = await this.db.staffRole.findFirst({
      where: { id: staffRoleId, schoolId: auth.schoolId },
    });
    if (!role) throw new NotFoundException('Role not found');
    const beyond = canGrant(auth.permissions ?? [], role.permissions);
    if (beyond.length > 0 && !isDelegate(auth.permissions ?? [])) {
      throw new ForbiddenException(
        `You cannot put someone on "${role.name}" because it includes access you do not have yourself`,
      );
    }
    return beyond;
  }

  async create(auth: AuthUser, dto: CreateUserDto) {
    const accountType = dto.role ?? DEFAULT_STAFF_ROLE;
    if (!canAssignRole(auth, accountType)) {
      throw new ForbiddenException(
        accountType === 'OWNER'
          ? 'Only the proprietor can make someone a proprietor'
          : 'You cannot create staff accounts',
      );
    }
    // Assigning a role hands over everything in it, so the same rule as the role editor applies:
    // you cannot give away authority you do not hold yourself — unless administering access is
    // your job, in which case what you handed over beyond your own reach is recorded.
    const delegated = dto.staffRoleId ? await this.assertMayAssign(auth, dto.staffRoleId) : [];

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
          role: accountType,
          passwordHash: await bcrypt.hash(plain, BCRYPT_ROUNDS),
        },
        select: { id: true, name: true, email: true, role: true, active: true },
      });
      await this.db.audit(auth.schoolId, auth.sub, 'user.create', 'User', user.id, {
        email,
        role: accountType,
        ...(delegated.length ? { delegated } : {}),
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
    if (!user) throw new NotFoundException('Staff member not found');
    if (!canManageUser(auth, user.role)) {
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
    const delegated = dto.staffRoleId ? await this.assertMayAssign(auth, dto.staffRoleId) : [];

    // Self-protection: changing your own role or switching yourself off is how admins
    // accidentally lock themselves out.
    if (target.id === auth.sub && (dto.role !== undefined || dto.active === false)) {
      throw new BadRequestException('You cannot change your own role or deactivate yourself');
    }
    if (dto.role !== undefined && !canAssignRole(auth, dto.role)) {
      // Only the proprietor's own rank survives as a rank rule — see common/roles.ts.
      throw new ForbiddenException(
        dto.role === 'OWNER'
          ? 'Only the proprietor can make someone a proprietor'
          : 'You cannot hand out that role',
      );
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
    await this.db.auditChange(
      auth.schoolId,
      auth.sub,
      'user.update',
      'User',
      id,
      {
        name: target.name,
        phone: target.phone,
        role: target.role,
        staffRoleId: target.staffRoleId,
        active: target.active,
      },
      { ...dto, ...(delegated.length ? { delegated } : {}) } as Record<string, unknown>,
    );
    return user;
  }

  /**
   * Cut an account off and send its owner a way back in.
   *
   * Three things happen, and the order matters. The old password is replaced by one nobody has —
   * not the admin, not anybody — every session it had opened dies with it, and the account holder
   * is sent their own reset link (or texted a code). This is the button reached for when a laptop
   * goes missing or somebody has left, so leaving live sessions running would make it ceremonial.
   *
   * **The administrator never sees a credential.** It used to hand back a temporary password,
   * which quietly made "restore this person's access" and "become this person" the same act: the
   * system administrator holds no fee permissions by design, but a bursar's temporary password
   * would have handed them the ledger anyway. Delivery to the account holder is what keeps
   * administering access separate from holding it.
   *
   * If delivery genuinely cannot happen — a LAN box with no mail credentials, or a phone-less
   * account — the temporary password comes back to the caller after all, plainly labelled. A
   * school locked out of its own box because the internet is down would be a worse failure than
   * the one this guards against, and the fallback is recorded in the audit row as what it is.
   */
  async resetPassword(auth: AuthUser, id: string, channel: 'email' | 'sms' = 'email') {
    const target = await this.loadTarget(auth, id);
    // Unknown to everyone, including us: the account is unreachable until its owner redeems the
    // link. `tempPassword()` is only *read* on the fallback path below.
    const plain = tempPassword();
    await this.db.user.update({
      where: { id: target.id },
      data: {
        passwordHash: await bcrypt.hash(plain, BCRYPT_ROUNDS),
        tokenVersion: { increment: 1 },
      },
    });

    const sent = await this.auth.issueResetFor(target, channel);
    await this.db.audit(auth.schoolId, auth.sub, 'user.resetPassword', 'User', id, {
      channel,
      delivered: sent.delivered,
      ...(sent.delivered ? {} : { handedOver: true, reason: sent.reason }),
    });

    return {
      id: target.id,
      email: target.email,
      delivered: sent.delivered,
      channel: sent.channel,
      // Not masked: the caller holds `users.view` and is looking at this person's contact details
      // on the same screen. Masking here would obscure nothing and only make the confirmation
      // ("sent to 024…") harder to check against the number they meant.
      sentTo: sent.delivered ? (channel === 'sms' ? target.phone : target.email) : null,
      // Present only when it could not be delivered — the UI shows it as a hand-over of last
      // resort rather than the normal outcome.
      temporaryPassword: sent.delivered ? undefined : plain,
      reason: sent.reason,
    };
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
    /**
     * Every session ends, including the one making this request.
     *
     * There is no session table and no `jti`, so there is no way to spare this browser while
     * killing the others — and of the two, killing everything is the behaviour that matches why
     * people change passwords in a hurry. Signing the caller back in from here would mean
     * handing a fresh token to client-side JavaScript, which is exactly what the httpOnly cookie
     * exists to avoid, so the caller is told to sign in again instead.
     */
    await this.db.user.update({
      where: { id: auth.sub },
      data: {
        passwordHash: await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS),
        tokenVersion: { increment: 1 },
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'user.self.password', 'User', auth.sub);
    return { ok: true, signedOut: true };
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
  resetPassword(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.svc.resetPassword(user, id, dto?.channel ?? 'email');
  }
}

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
