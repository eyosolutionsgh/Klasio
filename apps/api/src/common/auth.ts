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
import { PrismaService } from '../prisma/prisma.service';

export interface AuthUser {
  sub: string;
  schoolId: string;
  role: Role;
  tier: Tier;
  name: string;
}

const JWT_SECRET = () => process.env.JWT_SECRET ?? 'dev-secret-do-not-use-in-prod';

export function signToken(payload: AuthUser): string {
  return jwt.sign(payload, JWT_SECRET(), { expiresIn: '12h' });
}

export const Public = () => SetMetadata('isPublic', true);
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
export const RequireEntitlement = (code: string) => SetMetadata('entitlement', code);

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

    // Guardian sessions are signed with the same secret but are a different kind of principal.
    // Reject them explicitly so a guardian token can never reach a staff route.
    if ((user as { kind?: string }).kind === 'guardian') {
      throw new UnauthorizedException('Not a staff session');
    }

    /**
     * Re-check the account on every request. Tokens live 12h, so without this a deactivated
     * staff member would keep full access until their token expired — which defeats the point
     * of deactivating someone who has left. One indexed lookup is a fair price for revocation
     * that takes effect immediately.
     */
    const account = await this.db.user.findUnique({
      where: { id: user.sub },
      select: { active: true, role: true, schoolId: true },
    });
    if (!account?.active) throw new UnauthorizedException('This account is no longer active');
    // Trust the database over the token for role/tenant, so a demotion also applies at once.
    user = { ...user, role: account.role, schoolId: account.schoolId };
    req.user = user;

    const roles = this.reflector.getAllAndOverride<Role[]>('roles', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (roles?.length && !roles.includes(user.role)) {
      throw new ForbiddenException('Your role does not permit this action');
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
