import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  Ip,
  Logger,
  Module,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService, withTenant } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Public, signToken } from '../common/auth';
import { BCRYPT_ROUNDS, publicToken, safeEqual } from '../common/crypto';
import { lockRemainingMs, lockWaitMinutes, nextFailure } from '../common/login-throttle';
import { LicenceService } from '../licence/licence.module';
import { EmailModule, EmailService } from '../email/email.module';
import { SmsModule, SmsService } from '../sms/sms.module';
import { renderPasswordReset } from '../common/email-templates';
import {
  RESET_CODE_DIGITS,
  RESET_MAX_CODE_ATTEMPTS,
  RESET_TTL_MINUTES,
  hashResetCode,
  hashResetToken,
  resetRequestAllowed,
  resetState,
  resetStateMessage,
} from '../common/password-reset';

class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;
}

class ForgotPasswordDto {
  @IsEmail() email: string;
  /**
   * Where to send it. Defaults to email, which is the address they signed in with and the only
   * one every staff member is guaranteed to have — `User.phone` is optional.
   */
  @IsOptional() @IsIn(['email', 'sms']) channel?: 'email' | 'sms';
}

class ResetPasswordDto {
  @IsString() @MinLength(8) @MaxLength(200) token: string;
  @IsString() @MinLength(8) @MaxLength(200) password: string;
}

/**
 * Redeeming a texted code, kept apart from the link above.
 *
 * Deliberately a separate DTO and a separate route rather than one endpoint that takes either.
 * A six-digit code and a 32-byte token are guessable to wildly different degrees, and the code
 * path is the one that has to count attempts; merging them invites the bug where a code is
 * accepted somewhere only a token was ever meant to go.
 */
class ResetPasswordByCodeDto {
  @IsEmail() email: string;
  @IsString() @MinLength(4) @MaxLength(12) code: string;
  @IsString() @MinLength(8) @MaxLength(200) password: string;
}

/** At most one housekeeping sweep of `LoginThrottle` an hour, per API process. */
const SWEEP_INTERVAL_MS = 60 * 60_000;
/** A row quiet for this long has nothing left to say — every lock is far shorter. */
const SWEEP_AFTER_MS = 24 * 60 * 60_000;

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private db: PrismaService,
    private licence: LicenceService,
    private email: EmailService,
    private sms: SmsService,
  ) {}

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
    return withTenant(user.schoolId, async () => {
      const school = await this.db.school.findUniqueOrThrow({ where: { id: user.schoolId } });
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
   * Answers identically whether or not the address has an account. Sign-in already refuses to say
   * who has an account ("Invalid email or password"), and an endpoint that answered "no such user"
   * here would hand back exactly what that one withholds — a way to enumerate every staff address
   * on the platform, one guess at a time.
   *
   * The send is awaited but its result is discarded for the same reason.
   */
  async forgotPassword(dto: ForgotPasswordDto, ip?: string) {
    const email = dto.email.toLowerCase();
    const channel = dto.channel ?? 'email';
    /**
     * The same answer in every case, including the ones below where nothing is sent.
     *
     * `channel` is echoed so the page can say "check your phone" rather than guess, but it is the
     * channel that was *asked for*, never the one that was used — saying "we sent an email
     * instead" would report that no mobile number is on file, which is a fact about whether the
     * account exists and what it holds.
     */
    const generic = { sent: true, channel, expiresInMinutes: RESET_TTL_MINUTES };

    // No tenant yet — the same deliberate use of the unscoped client as `login`.
    const user = await this.db.system.user.findUnique({ where: { email } });
    if (!user || !user.active) return generic;

    const school = await this.db.system.school.findUnique({ where: { id: user.schoolId } });
    if (!school) return generic;

    /**
     * A number is required to text one, and many staff have none on file.
     *
     * Silently falling back to email would be friendlier but dishonest: the reply already says
     * "check your phone", and a person who never gets a text would keep asking. Returning the
     * generic answer without sending is the only option that neither lies to them nor tells an
     * attacker which addresses have a mobile number recorded.
     */
    if (channel === 'sms' && !user.phone) return generic;

    /**
     * Both limits are new, and the SMS channel is why they had to be.
     *
     * This endpoint takes no authentication, and on the SMS path every call spends a credit the
     * school paid for — so unthrottled it is a way to bill a stranger's school from a login page.
     * The email path has the milder version of the same problem: fifty messages is where the one
     * that matters goes to die.
     */
    const since = new Date(Date.now() - 60 * 60_000);
    const [count, last] = await Promise.all([
      this.db.system.passwordReset.count({ where: { userId: user.id, createdAt: { gte: since } } }),
      this.db.system.passwordReset.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);
    if (!resetRequestAllowed({ count, lastRequestedAt: last?.createdAt ?? null }, new Date())) {
      return generic;
    }

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

    const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000);

    if (channel === 'sms') {
      // Six digits, from the same CSPRNG the guardian codes use. `randomInt` rather than
      // `Math.random`, which is predictable enough to be worth guessing at.
      const code = String(randomInt(0, 10 ** RESET_CODE_DIGITS)).padStart(RESET_CODE_DIGITS, '0');
      const codeSalt = publicToken(16);
      await this.db.system.passwordReset.create({
        data: {
          schoolId: user.schoolId,
          userId: user.id,
          channel: 'SMS',
          codeSalt,
          tokenHash: hashResetCode(codeSalt, code),
          expiresAt,
          requestedIp: ip ?? null,
        },
      });
      // `sendOtp` reads the school through the tenant client, so it has to run in scope. The
      // plaintext code goes no further than that call — see SmsService.sendOtp.
      /**
       * Swallowed towards the caller, logged towards us.
       *
       * The reply must not change shape when delivery fails — that would report whether an
       * account exists just as surely as a different status code would. But a send that fails
       * silently on both sides is a reset flow that is broken with nobody to notice: the person
       * waits for a text that is never coming and the log says a code was issued.
       *
       * Note `sendOtp` *returns* `{ ok: false }` for a gateway rejection rather than throwing —
       * an unreachable Nalo, a bad sender ID, an unknown MSISDN. Catching only the throw caught
       * the rare case and missed every likely one, which is exactly how this went unnoticed the
       * first time: the row said a code was issued, the gateway had rejected it, and nothing
       * anywhere said so.
       */
      const sent = await withTenant(user.schoolId, () =>
        this.sms.sendOtp({
          schoolId: user.schoolId,
          phone: user.phone!,
          code,
          ttlMinutes: RESET_TTL_MINUTES,
          purpose: 'staff-reset',
        }),
      ).catch((e) => {
        this.log.error(`Password reset SMS threw for user ${user.id}: ${(e as Error)?.message}`);
        return { ok: false };
      });
      if (!sent.ok) {
        this.log.error(`Password reset SMS was not delivered for user ${user.id}`);
      }
      return generic;
    }

    const token = publicToken(32);
    await this.db.system.passwordReset.create({
      data: {
        schoolId: user.schoolId,
        userId: user.id,
        channel: 'EMAIL',
        tokenHash: hashResetToken(token),
        expiresAt,
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
        // The school's own crest, not Klasio's: a head teacher resetting at 7am should see their
        // school, and a message that looked like vendor mail is easier to mistake for phishing.
        crest: await this.email.loadCrest(school.logoUrl),
      }),
    });

    return generic;
  }

  /**
   * Issue a reset to a named account, on someone else's instruction.
   *
   * The administrator's version of `forgotPassword`, and deliberately the *same* machinery: one
   * expiring, single-use, session-killing row, superseding any outstanding ones. What differs is
   * only what may be said out loud. `forgotPassword` answers an unauthenticated stranger, so it
   * must never reveal whether an address exists or whether delivery worked; this caller is a
   * signed-in administrator who is already looking at the account, so it reports the truth —
   * without which the caller cannot know to fall back to handing something over in person.
   *
   * It mints no password and returns no credential. That is the point: an administrator who never
   * sees a password cannot sign in as the bursar, so restoring somebody's access stops being a
   * way to acquire it.
   */
  async issueResetFor(
    user: { id: string; name: string; email: string; phone: string | null; schoolId: string },
    channel: 'email' | 'sms',
  ): Promise<{ delivered: boolean; channel: 'email' | 'sms'; reason?: string }> {
    if (channel === 'sms' && !user.phone) {
      return { delivered: false, channel, reason: 'no-phone' };
    }
    const school = await this.db.system.school.findUnique({ where: { id: user.schoolId } });
    if (!school) return { delivered: false, channel, reason: 'no-school' };

    await this.db.system.passwordReset.updateMany({
      where: { userId: user.id, consumedAt: null, supersededAt: null },
      data: { supersededAt: new Date() },
    });
    const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000);

    if (channel === 'sms') {
      const code = String(randomInt(0, 10 ** RESET_CODE_DIGITS)).padStart(RESET_CODE_DIGITS, '0');
      const codeSalt = publicToken(16);
      await this.db.system.passwordReset.create({
        data: {
          schoolId: user.schoolId,
          userId: user.id,
          channel: 'SMS',
          codeSalt,
          tokenHash: hashResetCode(codeSalt, code),
          expiresAt,
        },
      });
      const sent = await withTenant(user.schoolId, () =>
        this.sms.sendOtp({
          schoolId: user.schoolId,
          phone: user.phone!,
          code,
          ttlMinutes: RESET_TTL_MINUTES,
          purpose: 'staff-reset',
        }),
      ).catch((e) => {
        this.log.error(
          `Admin-issued reset SMS threw for user ${user.id}: ${(e as Error)?.message}`,
        );
        return { ok: false };
      });
      return { delivered: sent.ok, channel, ...(sent.ok ? {} : { reason: 'send-failed' }) };
    }

    const token = publicToken(32);
    await this.db.system.passwordReset.create({
      data: {
        schoolId: user.schoolId,
        userId: user.id,
        channel: 'EMAIL',
        tokenHash: hashResetToken(token),
        expiresAt,
      },
    });
    const base = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';
    try {
      await this.email.send({
        to: user.email,
        toName: user.name,
        kind: 'password-reset',
        message: renderPasswordReset({
          name: user.name,
          schoolName: school.name,
          resetUrl: `${base}/reset-password?token=${encodeURIComponent(token)}`,
          expiresInMinutes: RESET_TTL_MINUTES,
          crest: await this.email.loadCrest(school.logoUrl),
        }),
      });
      return { delivered: true, channel };
    } catch (e) {
      // A box on a school LAN with no mail credentials is a supported deployment, not a fault.
      // Saying so lets the caller fall back rather than leaving somebody locked out.
      this.log.error(
        `Admin-issued reset email failed for user ${user.id}: ${(e as Error)?.message}`,
      );
      return { delivered: false, channel, reason: 'send-failed' };
    }
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
    return this.applyReset(row, dto.password);
  }

  /**
   * Redeem a texted code.
   *
   * The code is not unique on its own, so this finds the person's most recent live request and
   * checks the code against that one row — the same shape as the guardian OTP. Only the newest
   * counts: `forgotPassword` supersedes the rest, so an older code cannot be dredged up.
   */
  async resetPasswordByCode(dto: ResetPasswordByCodeDto) {
    const email = dto.email.toLowerCase();
    const bad = new NotFoundException('That code is not valid. Ask for a new one.');

    const user = await this.db.system.user.findUnique({ where: { email } });
    if (!user) throw bad;

    const row = await this.db.system.passwordReset.findFirst({
      where: { userId: user.id, channel: 'SMS', consumedAt: null, supersededAt: null },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, email: true, active: true, schoolId: true } } },
    });
    if (!row?.codeSalt) throw bad;

    const state = resetState(row, new Date());
    if (state !== 'valid') throw new GoneException(resetStateMessage(state));

    /**
     * A wrong guess costs an attempt, and the count is what makes six digits safe.
     *
     * Incremented before the comparison is answered so that a client which hangs up mid-request
     * still pays for the guess — otherwise the ceiling is advisory and the million possibilities
     * are back on the table.
     */
    if (!safeEqual(row.tokenHash, hashResetCode(row.codeSalt, dto.code.trim()))) {
      const after = await this.db.system.passwordReset.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      if (after.attempts >= RESET_MAX_CODE_ATTEMPTS) {
        throw new GoneException(resetStateMessage('exhausted'));
      }
      throw bad;
    }

    return this.applyReset(row, dto.password);
  }

  /**
   * Spend the request and rotate the password. Shared by both channels, because everything from
   * here down — the race, the session kill, the throttle clear, the audit row — is identical
   * whether the person proved themselves with a link or with six digits.
   */
  private async applyReset(
    row: { id: string; userId: string; user: { active: boolean; email: string; schoolId: string } },
    password: string,
  ) {
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
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
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
        // The staff role's name is the person's job — "Bursar", "System Administrator". The
        // `role` enum beside it says only what kind of principal they are, so the chrome has
        // something true to put under their name instead of "FRONT DESK".
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          staffRole: { select: { name: true } },
        },
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
        // Decides whether the fees screen offers to release a held report at all.
        reportsRequireFeeClearance: school.reportsRequireFeeClearance,
        // School Setup edits these, so they ride along with the context it already loads.
        admissionNoFormat: school.admissionNoFormat,
        admissionNoNext: school.admissionNoNext,
        // The chrome renders the crest and brand colour on every page, so they ride along
        // with /me rather than costing a second round trip per navigation.
        brandColor: school.brandColor,
        hasLogo: !!school.logoUrl,
      },
      currentTerm,
      /**
       * From the licence, not from the tier alone: a licence may grant individual codes on top of
       * its bundle, and those have to reach the web app or it will hide a feature the school paid
       * for. The API guard reads the same source.
       */
      entitlements: this.licence.entitlements(),
      /**
       * Enough for the portal to warn about a lapse, and no more.
       *
       * Rides on /me rather than being fetched separately because the banner has to be able to
       * appear on every page, and a second request per navigation to say "nothing is wrong" —
       * which is the answer almost every time — is not worth making.
       */
      licence: {
        state: this.licence.snapshot().state,
        daysRemaining: this.licence.snapshot().daysRemaining ?? null,
      },
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
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto, @Ip() ip: string) {
    return this.svc.forgotPassword(dto, ip);
  }

  @Public()
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.svc.resetPassword(dto);
  }

  /** The texted-code counterpart of `reset-password`. Separate on purpose — see the DTO. */
  @Public()
  @Post('reset-password/code')
  resetPasswordByCode(@Body() dto: ResetPasswordByCodeDto) {
    return this.svc.resetPasswordByCode(dto);
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
  imports: [EmailModule, SmsModule],
  controllers: [PublicAuthController, AuthController],
  providers: [AuthService],
  // UsersModule resets staff passwords through `issueResetFor`, so that an administrator restoring
  // access never handles a credential. Exported rather than reimplemented: a second copy of the
  // reset flow is a second place for its expiry, supersede and single-use rules to drift.
  exports: [AuthService],
})
export class AuthModule {}
