import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import type { Role, Tier } from '@prisma/client';
import { hasEntitlement } from './entitlements';
import { effectivePermissions } from './effective-permissions';
import { PERMISSIONS } from './permissions';
import { PrismaService, withTenant } from '../prisma/prisma.service';

export interface AuthUser {
  sub: string;
  schoolId: string;
  role: Role;
  tier: Tier;
  name: string;
  /**
   * Resolved fresh on every request, never carried in the token.
   *
   * Tokens live 12 hours. A permission taken away has to bite now, not at the end of the day —
   * especially one over money. The account lookup below already happens for the same reason, so
   * this costs nothing extra.
   */
  permissions?: string[];
}

const JWT_SECRET = () => process.env.JWT_SECRET ?? 'dev-secret-do-not-use-in-prod';

export function signToken(payload: AuthUser): string {
  return jwt.sign(payload, JWT_SECRET(), { expiresIn: '12h' });
}

export const Public = () => SetMetadata('isPublic', true);
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
export const RequireEntitlement = (code: string) => SetMetadata('entitlement', code);

/**
 * What this route actually requires. Prefer this over `@Roles`.
 *
 * A role is a bundle the school edits; a permission is the thing the code depends on. Gating on
 * the role means a school cannot say "our head of department may not touch fees" without us
 * shipping a new role name.
 */
export const RequirePermission = (...codes: string[]) => SetMetadata('permissions', codes);

/**
 * Any one of these is enough.
 *
 * Most routes want every listed code, so `@RequirePermission` ANDs them. A few are genuinely
 * reachable two ways: the report-card remark endpoint writes both the class teacher's remark and
 * the head's, and either permission should get you in — the service then decides which fields you
 * may actually touch. Expressing that as an AND locked heads out of their own remark.
 */
export const RequireAnyPermission = (...codes: string[]) => SetMetadata('anyPermissions', codes);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private db: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Missing token');
    let user: AuthUser;
    try {
      user = jwt.verify(token, JWT_SECRET()) as AuthUser;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Guardians and students are different kinds of principal signed with the same secret.
    // Neither may reach a staff route, whatever their token otherwise says.
    const kind = (user as { kind?: string }).kind;
    if (kind === 'guardian' || kind === 'student') {
      throw new UnauthorizedException('Not a staff session');
    }

    /**
     * Re-check the account on every request. Tokens live 12h, so without this a deactivated
     * staff member would keep full access until their token expired — which defeats the point
     * of deactivating someone who has left. One indexed lookup is a fair price for revocation
     * that takes effect immediately.
     */
    // Scoped to the school the token claims. If the claim is a lie the policies return nothing
    // and the request fails closed, which is the behaviour we want either way.
    const account = await withTenant(user.schoolId, () =>
      this.db.user.findUnique({
        where: { id: user.sub },
        select: {
          active: true,
          role: true,
          schoolId: true,
          extraPermissions: true,
          revokedPermissions: true,
          staffRole: { select: { permissions: true } },
        },
      }),
    );
    if (!account?.active) throw new UnauthorizedException('This account is no longer active');
    // Trust the database over the token for role, tenant and permissions, so a demotion or a
    // withdrawn permission applies at once rather than when the token happens to expire.
    const permissions = effectivePermissions({
      role: account.role,
      rolePermissions: account.staffRole?.permissions ?? [],
      extraPermissions: account.extraPermissions,
      revokedPermissions: account.revokedPermissions,
    });
    user = { ...user, role: account.role, schoolId: account.schoolId, permissions };
    req.user = user;

    const roles = this.reflector.getAllAndOverride<Role[]>('roles', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (roles?.length && !roles.includes(user.role)) {
      throw new ForbiddenException('Your role does not permit this action');
    }
    /**
     * Permission check. Every listed code is required, not any of them: a route that both reads
     * and writes should say so, and "any of" would quietly grant the write to someone who only
     * holds the read.
     */
    const required = this.reflector.getAllAndOverride<string[]>('permissions', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required?.length) {
      const missing = required.filter((code) => !permissions.includes(code));
      if (missing.length > 0) {
        const label = PERMISSIONS.find((p) => p.code === missing[0])?.label;
        throw new ForbiddenException(
          label
            ? `You do not have permission to ${label.charAt(0).toLowerCase()}${label.slice(1)}`
            : 'You do not have permission to do that',
        );
      }
    }

    const anyOf = this.reflector.getAllAndOverride<string[]>('anyPermissions', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (anyOf?.length && !anyOf.some((code) => permissions.includes(code))) {
      const labels = anyOf
        .map((c) => PERMISSIONS.find((p) => p.code === c)?.label ?? c)
        .join(', or ');
      throw new ForbiddenException(`You need permission to: ${labels}`);
    }

    const entitlement = this.reflector.getAllAndOverride<string>('entitlement', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (entitlement && !hasEntitlement(user.tier, entitlement)) {
      throw new ForbiddenException(`This feature is not included in your school's package`);
    }
    return true;
  }
}
