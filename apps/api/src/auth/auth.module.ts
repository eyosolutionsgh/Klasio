import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { PrismaService, withTenant } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Public, signToken } from '../common/auth';
import { entitlementsForTier } from '../common/entitlements';

class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;
}

@Injectable()
export class AuthService {
  constructor(private db: PrismaService) {}

  async login(dto: LoginDto) {
    // Sign-in has no tenant yet — an email identifies a person across every school — so this
    // is one of the few deliberate uses of the unscoped client.
    const user = await this.db.system.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!user || !user.active) throw new UnauthorizedException('Invalid email or password');
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid email or password');
    // From here on the school is known, so everything runs inside its tenant scope — the
    // request has no principal yet, so nothing else would put one there.
    return withTenant(user.schoolId, async () => {
      const school = await this.db.school.findUniqueOrThrow({ where: { id: user.schoolId } });
      const payload: AuthUser = {
        sub: user.id,
        schoolId: user.schoolId,
        role: user.role,
        tier: school.tier,
        name: user.name,
      };
      await this.db.audit(user.schoolId, user.id, 'auth.login', 'User', user.id);
      return {
        token: signToken(payload),
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
        school: { id: school.id, name: school.name, tier: school.tier, currency: school.currency },
      };
    });
  }

  async me(auth: AuthUser) {
    const [user, school, currentTerm] = await Promise.all([
      this.db.user.findUniqueOrThrow({
        where: { id: auth.sub },
        select: { id: true, name: true, email: true, role: true },
      }),
      this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } }),
      this.db.term.findFirst({
        where: { isCurrent: true, academicYear: { schoolId: auth.schoolId, isCurrent: true } },
        include: { academicYear: { select: { name: true } } },
      }),
    ]);
    return {
      user,
      school: {
        id: school.id,
        name: school.name,
        motto: school.motto,
        tier: school.tier,
        currency: school.currency,
        address: school.address,
        phone: school.phone,
        email: school.email,
        website: school.website,
        reportTemplate: school.reportTemplate,
        // School Setup edits these, so they ride along with the context it already loads.
        admissionNoFormat: school.admissionNoFormat,
        admissionNoNext: school.admissionNoNext,
        // The chrome renders the crest and brand colour on every page, so they ride along
        // with /me rather than costing a second round trip per navigation.
        brandColor: school.brandColor,
        hasLogo: !!school.logoUrl,
      },
      currentTerm,
      entitlements: entitlementsForTier(school.tier),
    };
  }
}

@Controller()
export class AuthController {
  constructor(private svc: AuthService) {}

  @Public()
  @Post('auth/login')
  login(@Body() dto: LoginDto) {
    return this.svc.login(dto);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.svc.me(user);
  }
}

@Module({ controllers: [AuthController], providers: [AuthService] })
export class AuthModule {}
