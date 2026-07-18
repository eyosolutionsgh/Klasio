import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, lastValueFrom } from 'rxjs';
import { withTenant } from '../prisma/prisma.service';

/**
 * Puts the authenticated principal's school in scope for the whole handler, so row-level
 * security applies to every query it makes.
 *
 * Runs after the guards, which is what makes it work: by then the staff, guardian or student
 * guard has established who is asking. Anything with no principal — sign-in, gateway webhooks —
 * runs unscoped and must reach for `prisma.system` deliberately.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const schoolId: string | undefined =
      req.user?.schoolId ?? req.guardian?.schoolId ?? req.student?.schoolId;
    if (!schoolId) return next.handle();
    return from(withTenant(schoolId, () => lastValueFrom(next.handle())));
  }
}
