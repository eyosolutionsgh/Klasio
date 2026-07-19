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
import { LicenceService } from '../licence/licence.service';
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
   * The value of `User.tokenVersion` when this token was signed.
   *
   * Optional only for tokens issued before the column existed; those read as 0 and match the
   * default, so deploying this does not sign everybody out. Every token signed from now on
   * carries it.
   */
  tokenVersion?: number;
  /**
   * Resolved fresh on every request, never carried in the token.
   *
   * Tokens live 12 hours. A permission taken away has to bite now, not at the end of the day —
   * especially one over money. The account lookup below already happens for the same reason, so
   * this costs nothing extra.
   */
  permissions?: string[];
}

/**
 * Values that appear in `.env.example` or as a fallback in this source tree.
 *
 * "Set" is not the same as "secret". Standing this repository up the obvious way — copy
 * `.env.example`, fill in the database URL, deploy — leaves a signing key that is published on
 * every clone, and a check that only asked whether the variable was populated would wave it
 * through while giving the impression the question had been asked. The whole point of refusing a
 * missing key is that the key must be unguessable, and these are the most guessable values there
 * are.
 */
const PUBLISHED_SECRETS = new Set([
  'change-me-in-production',
  'dev-secret',
  'dev-secret-do-not-use-in-prod',
  'dev-platform-secret-do-not-use-in-prod',
]);

export const isPublishedSecret = (value: string) => PUBLISHED_SECRETS.has(value.trim());

/**
 * The key every school session is signed with.
 *
 * Refused outright in production rather than falling back, for the same reason
 * `LICENCE_PUBLIC_KEY` is: the fallback string is public in this repository, so a deployment
 * that forgot the variable is not merely using a weak key — it is using a key anyone reading
 * the source already has. With it, a forged token naming any `schoolId` and the OWNER role
 * passes verification, and every check downstream of this file is decoration. Booting is the
 * wrong moment to be forgiving.
 *
 * Exported because guardian and student sessions are signed with the same key. They each had
 * their own copy of this line and the fallbacks had drifted — `'dev-secret'` in the student
 * portal against `'dev-secret-do-not-use-in-prod'` here — so on a bare checkout a staff token
 * and a student token could not be verified by each other's guard.
 */
export const jwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (secret && !isPublishedSecret(secret)) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      secret
        ? 'JWT_SECRET is still set to the value from .env.example, which is public in this ' +
            'repository. Generate one: openssl rand -base64 48'
        : 'JWT_SECRET must be set — it signs every school session.',
    );
  }
  return 'dev-secret-do-not-use-in-prod';
};

export function signToken(payload: AuthUser): string {
  return jwt.sign(payload, jwtSecret(), { expiresIn: '12h' });
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
    private licence: LicenceService,
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
      user = jwt.verify(token, jwtSecret()) as AuthUser;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    /**
     * Other kinds of principal exist — guardians, students, and EYO's own staff — and none of
     * them may reach a staff route whatever their token otherwise says.
     *
     * An allowlist, not a denylist. This named the two kinds that existed at the time, so any
     * *new* kind was admitted by default: the platform principal added later would have walked
     * straight through here and on to the account lookup below. A staff token carries no `kind`
     * at all, so "no kind" is the only thing that may pass, and adding a fourth principal cannot
     * silently reopen this.
     */
    const kind = (user as { kind?: string }).kind;
    if (kind !== undefined) throw new UnauthorizedException('Not a staff session');

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
          tokenVersion: true,
          extraPermissions: true,
          revokedPermissions: true,
          staffRole: { select: { permissions: true } },
        },
      }),
    );
    if (!account?.active) throw new UnauthorizedException('This account is no longer active');
    /**
     * A token issued before the password changed is dead.
     *
     * Without this, changing a password did nothing to the sessions that password had already
     * opened — they carried on for the rest of their 12 hours. That is precisely backwards: the
     * reason anyone changes a password in a hurry is that they believe someone else has it, and
     * the attacker is the one already holding a live token.
     */
    if ((user.tokenVersion ?? 0) !== account.tokenVersion) {
      throw new UnauthorizedException('Your password was changed. Please sign in again.');
    }
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
    /**
     * Asked of the licence, not of the tier alone.
     *
     * `hasEntitlement(user.tier, code)` would miss `extraEntitlements` — the codes a licence
     * grants on top of its bundle so the vendor can sell one Advanced feature to a Medium school.
     * The /me payload already reports those, so a tier-only check here would light the feature up
     * in the UI and then refuse it at the API: the "button that always fails" this codebase
     * fixed once already, reintroduced one layer down.
     */
    if (entitlement && !this.licence.entitlements().includes(entitlement)) {
      throw new ForbiddenException(`This feature is not included in your school's package`);
    }
    return true;
  }
}
