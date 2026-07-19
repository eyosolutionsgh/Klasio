import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  Ip,
  Module,
  NotFoundException,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { Prisma, Tier } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService, withTenant } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Public, signToken } from '../common/auth';
import { BCRYPT_ROUNDS, publicToken } from '../common/crypto';
import { lockRemainingMs, lockWaitMinutes, nextFailure } from '../common/login-throttle';
import { entitlementsForTier } from '../common/entitlements';
import { ROLE_PRESETS, sanitizePermissions } from '../common/permissions';
import { hashInviteToken } from '../platform/platform.module';
import { BillingModule, BillingService } from '../billing/billing.module';
import { EmailModule, EmailService } from '../email/email.module';
import { renderPasswordReset } from '../common/email-templates';
import {
  RESET_TTL_MINUTES,
  hashResetToken,
  resetState,
  resetStateMessage,
} from '../common/password-reset';

class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;
}

class ForgotPasswordDto {
  @IsEmail() email: string;
}

class ResetPasswordDto {
  @IsString() @MinLength(8) @MaxLength(200) token: string;
  @IsString() @MinLength(8) @MaxLength(200) password: string;
}

class RegisterDto {
  /**
   * The invitation EYO issued. Registration is vendor-initiated: without one of these there is
   * no way to create a school, which is what stops the platform from being open signup.
   */
  @IsString() @MinLength(8) @MaxLength(200) token: string;
  @IsString() @MinLength(2) @MaxLength(120) schoolName: string;
  @IsString() @MinLength(2) @MaxLength(80) ownerName: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) @MaxLength(200) password: string;
}

/**
 * A URL-safe stem for a school's name.
 *
 * Not unique on its own — "St. Mary's" is a great many schools — so the caller adds a suffix
 * until the insert succeeds.
 */
/** At most one housekeeping sweep of `LoginThrottle` an hour, per API process. */
const SWEEP_INTERVAL_MS = 60 * 60_000;
/** A row quiet for this long has nothing left to say — every lock is far shorter. */
const SWEEP_AFTER_MS = 24 * 60 * 60_000;

function slugStem(name: string): string {
  const stem = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  // A name of nothing but punctuation would otherwise produce an empty slug, and every such
  // school would collide with every other.
  return stem || 'school';
}

@Injectable()
export class AuthService {
  constructor(
    private db: PrismaService,
    private billing: BillingService,
    private email: EmailService,
  ) {}

  /**
   * Look at an invitation without spending it, so the sign-up page can greet the school by name
   * and refuse early rather than after they have filled in a form.
   */
  async inspectInvitation(token: string) {
    const invitation = await this.db.system.schoolInvitation.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      select: { schoolName: true, email: true, expiresAt: true, acceptedAt: true, revokedAt: true },
    });
    if (!invitation) throw new NotFoundException('That invitation link is not valid');
    if (invitation.acceptedAt) throw new GoneException('That invitation has already been used');
    if (invitation.revokedAt) throw new GoneException('That invitation has been withdrawn');
    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new GoneException('That invitation has expired — ask EYO for a new one');
    }
    // The email is echoed so the form can show which address the invitation is bound to. The
    // school name is a default the owner may correct; only the address is fixed.
    return { schoolName: invitation.schoolName, email: invitation.email };
  }

  /**
   * Register a new school and its owner, and sign them straight in.
   *
   * The only route in the product that creates a school, and it takes an invitation: EYO decides
   * who may put a school on the platform. Before invitations existed this was open signup —
   * anyone could mint unlimited schools under any name they liked.
   *
   * Deliberately minimal: a School row, an OWNER, and the standard staff roles. It invents no
   * academic year, no terms, no levels — those are the school's own facts, and a wrong calendar
   * quietly attached to every record is worse than an empty one the owner fills in. The portal
   * renders fine without them (`me` reports "no current term", the dashboard counts zeros), and
   * the owner lands on the setup page to enter the real ones.
   *
   * Everything starts on BASIC. A tier is only ever raised by a confirmed payment — see
   * `BillingService.settle`.
   */
  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const name = dto.schoolName.trim();

    const invitation = await this.db.system.schoolInvitation.findUnique({
      where: { tokenHash: hashInviteToken(dto.token) },
    });
    if (!invitation) throw new NotFoundException('That invitation link is not valid');
    if (invitation.acceptedAt) throw new GoneException('That invitation has already been used');
    if (invitation.revokedAt) throw new GoneException('That invitation has been withdrawn');
    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new GoneException('That invitation has expired — ask EYO for a new one');
    }
    /**
     * The invitation names the address that may accept it.
     *
     * Without this the token alone would be a bearer credential for creating a school: forwarded
     * once, or read out of an inbox, and someone else registers in that school's name.
     */
    if (invitation.email !== email) {
      throw new ForbiddenException(
        `That invitation was issued to ${invitation.email}. Register with that address.`,
      );
    }

    // `User.email` is unique across every school, not per school, because sign-in identifies a
    // person by email alone before any tenant is known. Checked here so the caller gets a
    // sentence instead of a unique-constraint error.
    const taken = await this.db.system.user.findUnique({ where: { email } });
    if (taken) {
      throw new ConflictException('That email address already has an account. Log in instead.');
    }

    // No tenant exists yet — this is the same deliberate use of the unscoped client that
    // `login` opens with, and for the same reason. RLS on School would refuse the insert
    // under the app role, since `app.school_id` cannot name a row that does not exist.
    const stem = slugStem(name);
    let school: { id: string; name: string; tier: Tier; currency: string } | null = null;
    for (let attempt = 0; attempt < 5 && !school; attempt++) {
      const slug = attempt === 0 ? stem : `${stem}-${publicToken(4).toLowerCase()}`;
      try {
        school = await this.db.system.school.create({
          // The tier is the invitation's, not the form's — EYO may have agreed a paid plan up
          // front, and a school must never be able to name its own tier at signup.
          data: { name, slug, tier: invitation.tier },
          select: { id: true, name: true, tier: true, currency: true },
        });
      } catch (e) {
        // Slug collision only — anything else is a real failure and must not be retried.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    if (!school) throw new ConflictException('Could not create that school. Try a different name.');

    const user = await this.db.system.user.create({
      data: {
        schoolId: school.id,
        name: dto.ownerName.trim(),
        email,
        role: 'OWNER',
        passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
      },
      select: { id: true, name: true, email: true, role: true },
    });

    // From here the school exists, so everything runs scoped to it — `audit` writes through the
    // tenant-aware proxy and RLS would refuse it outside.
    await withTenant(school.id, async () => {
      for (const preset of ROLE_PRESETS) {
        await this.db.staffRole.create({
          data: {
            schoolId: school!.id,
            name: preset.name,
            description: preset.description,
            permissions: sanitizePermissions(preset.permissions),
            presetKey: preset.key,
          },
        });
      }
      await this.db.audit(school!.id, user.id, 'school.registered', 'School', school!.id, {
        name: school!.name,
        tier: school!.tier,
        invitationId: invitation.id,
      });
    });

    // Spend the invitation last: if anything above failed, the school can try again with it.
    // Single use from here on — the unique `schoolId` also makes a double-accept impossible.
    await this.db.system.schoolInvitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date(), schoolId: school.id },
    });

    const payload: AuthUser = {
      sub: user.id,
      schoolId: school.id,
      role: 'OWNER',
      tier: school.tier,
      name: user.name,
      tokenVersion: 0,
    };
    return {
      token: signToken(payload),
      user,
      school: { id: school.id, name: school.name, tier: school.tier, currency: school.currency },
    };
  }

  /**
   * Shut the door on an address that has just guessed wrong.
   *
   * Recorded for addresses that have no account too — see the note on `LoginThrottle`. The
   * failure is stored before the caller is refused, so a client that hangs up early still pays
   * for the attempt.
   */
  private async recordFailure(email: string) {
    const now = new Date();
    const existing = await this.db.system.loginThrottle.findUnique({ where: { email } });
    const next = nextFailure(existing, now);
    await this.db.system.loginThrottle.upsert({
      where: { email },
      create: { email, ...next },
      update: next,
    });
    await this.sweepSettledThrottles(now);
  }

  /**
   * Drop rows that have been quiet for a day.
   *
   * An address that eventually signs in clears its own row, but one that never does — a spray of
   * invented addresses — leaves a row behind for each. Attached to the failure path because that
   * is exactly the traffic that grows the table, and rate-limited in process so a flood does not
   * turn one delete per attempt into its own load problem. Best-effort: this is housekeeping, and
   * a sign-in must not fail because it could not be done.
   */
  private lastSweep = 0;
  private async sweepSettledThrottles(now: Date) {
    if (now.getTime() - this.lastSweep < SWEEP_INTERVAL_MS) return;
    this.lastSweep = now.getTime();
    await this.db.system.loginThrottle
      .deleteMany({ where: { updatedAt: { lt: new Date(now.getTime() - SWEEP_AFTER_MS) } } })
      .catch(() => undefined);
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();

    /**
     * Checked before the password is, and before the account is even looked up.
     *
     * Doing the bcrypt comparison first would mean an attacker still gets the server to burn a
     * hash on every guess, which is most of what makes a flood expensive to serve.
     */
    const throttle = await this.db.system.loginThrottle.findUnique({ where: { email } });
    const remaining = lockRemainingMs(throttle, new Date());
    if (remaining > 0) {
      throw new HttpException(
        `Too many sign-in attempts. Try again in ${lockWaitMinutes(remaining)} minute(s), ` +
          'or ask someone at your school with staff access to reset your password.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Sign-in has no tenant yet — an email identifies a person across every school — so this
    // is one of the few deliberate uses of the unscoped client.
    const user = await this.db.system.user.findUnique({ where: { email } });
    if (!user || !user.active) {
      await this.recordFailure(email);
      throw new UnauthorizedException('Invalid email or password');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.recordFailure(email);
      throw new UnauthorizedException('Invalid email or password');
    }
    // Proving the password clears the slate, so yesterday's fumbles never combine with today's.
    // Also how these rows are reaped: every address that ever signs in cleans up after itself.
    if (throttle) await this.db.system.loginThrottle.delete({ where: { email } }).catch(() => {});
    // From here on the school is known, so everything runs inside its tenant scope — the
    // request has no principal yet, so nothing else would put one there.
    // A scheduled downgrade whose paid period has ended is applied before the tier is read, not
    // after. The token carries the tier for its whole lifetime, so issuing one from a stale value
    // would keep a cancelled school on its old plan until that token expired.
    await this.billing.applyDueChanges(user.schoolId).catch(() => undefined);

    return withTenant(user.schoolId, async () => {
      const school = await this.db.school.findUniqueOrThrow({ where: { id: user.schoolId } });
      /**
       * A suspended school is turned away at the door, and told why.
       *
       * Deliberately not folded into the "invalid email or password" message above. That one is
       * vague on purpose, so it cannot be used to discover who has an account. This is the
       * opposite case: the credentials were right, and a head teacher staring at a login screen
       * needs to know it is a billing matter to take up with EYO, not a password to reset.
       */
      if (school.suspendedAt) {
        throw new ForbiddenException(
          school.suspendedReason
            ? `This school's access is suspended: ${school.suspendedReason}`
            : "This school's access is suspended. Please contact EYO.",
        );
      }
      const payload: AuthUser = {
        sub: user.id,
        schoolId: user.schoolId,
        role: user.role,
        tier: school.tier,
        name: user.name,
        tokenVersion: user.tokenVersion,
      };
      await this.db.audit(user.schoolId, user.id, 'auth.login', 'User', user.id);
      return {
        token: signToken(payload),
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
        school: { id: school.id, name: school.name, tier: school.tier, currency: school.currency },
      };
    });
  }

  /**
   * Ask for a reset link.
   *
   * Answers identically whether or not the address has an account, and whether or not the school
   * is suspended. Sign-in already refuses to say who has an account ("Invalid email or password"),
   * and an endpoint that answered "no such user" here would hand back exactly what that one
   * withholds — a way to enumerate every staff address on the platform, one guess at a time.
   *
   * The send is awaited but its result is discarded for the same reason.
   */
  async forgotPassword(dto: ForgotPasswordDto, ip?: string) {
    const email = dto.email.toLowerCase();
    const generic = { sent: true, expiresInMinutes: RESET_TTL_MINUTES };

    // No tenant yet — the same deliberate use of the unscoped client as `login`.
    const user = await this.db.system.user.findUnique({ where: { email } });
    if (!user || !user.active) return generic;

    const school = await this.db.system.school.findUnique({ where: { id: user.schoolId } });
    if (!school || school.suspendedAt) return generic;

    /**
     * Every earlier outstanding link for this person stops working now.
     *
     * Without this, asking twice leaves two live links, and the first — the one more likely to
     * have been read over someone's shoulder or left sitting in a forwarded mail — stays valid
     * for its full window. Resetting should always narrow the attack surface, never widen it.
     */
    await this.db.system.passwordReset.updateMany({
      where: { userId: user.id, consumedAt: null, supersededAt: null },
      data: { supersededAt: new Date() },
    });

    const token = publicToken(32);
    await this.db.system.passwordReset.create({
      data: {
        schoolId: user.schoolId,
        userId: user.id,
        tokenHash: hashResetToken(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
        requestedIp: ip ?? null,
      },
    });

    const base = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';
    await this.email.send({
      to: user.email,
      toName: user.name,
      kind: 'password-reset',
      message: renderPasswordReset({
        name: user.name,
        schoolName: school.name,
        resetUrl: `${base}/reset-password?token=${encodeURIComponent(token)}`,
        expiresInMinutes: RESET_TTL_MINUTES,
        // The school's own crest, not EYO's: a head teacher resetting at 7am should see their
        // school, and a message that looked like vendor mail is easier to mistake for phishing.
        crest: await this.email.loadCrest(school.logoUrl),
      }),
    });

    return generic;
  }

  /**
   * Redeem a reset link.
   *
   * Bumps `tokenVersion`, so every session that old password had already opened dies with it —
   * the point of resetting after a laptop goes missing. Also clears the login throttle: someone
   * who was locked out by failed guesses has just proved control of the mailbox, and leaving them
   * locked out would make the reset useless for the case that most needs it.
   */
  async resetPassword(dto: ResetPasswordDto) {
    const row = await this.db.system.passwordReset.findUnique({
      where: { tokenHash: hashResetToken(dto.token) },
      include: { user: { select: { id: true, email: true, active: true, schoolId: true } } },
    });
    // An unknown token and a malformed one are the same answer: there is nothing to learn here.
    if (!row) throw new NotFoundException('That reset link is not valid. Ask for a new one.');

    const state = resetState(row, new Date());
    if (state !== 'valid') throw new GoneException(resetStateMessage(state));
    if (!row.user.active) throw new ForbiddenException('That account is no longer active.');

    /**
     * Consume and rotate in one transaction.
     *
     * Two people redeeming the same link concurrently would otherwise both pass the state check
     * above and both set a password — the second silently overwriting the first. The unique
     * `tokenHash` plus the `consumedAt: null` guard means exactly one of them updates a row.
     */
    const consumed = await this.db.system.passwordReset.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new GoneException(resetStateMessage('consumed'));
    }

    await this.db.system.user.update({
      where: { id: row.userId },
      data: {
        passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
        tokenVersion: { increment: 1 },
      },
    });
    await this.db.system.loginThrottle
      .delete({ where: { email: row.user.email } })
      .catch(() => undefined);

    await withTenant(row.user.schoolId, () =>
      this.db.audit(row.user.schoolId, row.userId, 'auth.password_reset', 'User', row.userId),
    );

    return { ok: true };
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
      /**
       * What this person may actually do.
       *
       * The guard has always resolved this, but /me never returned it, so the web app had no way
       * to know — every screen offered every action and relied on the API to refuse. A librarian
       * saw a "Record payment" button that always failed. Gating the UI is not a security
       * boundary (the guard is), it is how a person can tell what their job includes.
       */
      permissions: auth.permissions ?? [],
    };
  }
}

/**
 * The unauthenticated door: signing in, and signing up.
 *
 * Kept apart from the authenticated controller below on purpose — the same reasoning as the
 * public admissions controller. Every route here is `@Public()` by intent, so nothing sits one
 * careless edit away from exposing a route that assumed a principal.
 */
@Controller('auth')
export class PublicAuthController {
  constructor(private svc: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.svc.login(dto);
  }

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.svc.register(dto);
  }

  /** Read an invitation so the sign-up page can greet the school and refuse a bad link early. */
  @Public()
  @Get('invitation')
  invitation(@Query('token') token: string) {
    return this.svc.inspectInvitation(token ?? '');
  }

  @Public()
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto, @Ip() ip: string) {
    return this.svc.forgotPassword(dto, ip);
  }

  @Public()
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.svc.resetPassword(dto);
  }
}

@Controller()
export class AuthController {
  constructor(private svc: AuthService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.svc.me(user);
  }
}

@Module({
  imports: [BillingModule, EmailModule],
  controllers: [PublicAuthController, AuthController],
  providers: [AuthService],
})
export class AuthModule {}
