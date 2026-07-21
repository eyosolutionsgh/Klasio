import {
  BadRequestException,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
  createParamDecorator,
} from '@nestjs/common';
import { Body, Delete, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import * as jwt from 'jsonwebtoken';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService, withTenant } from '../prisma/prisma.service';
import { FeesModule, FeesService } from '../fees/fees.module';
import { PaymentsModule, PaymentsService } from '../payments/payments.module';
import { CalendarModule, CalendarService } from '../calendar/calendar.module';
import { ResourcesModule, ResourcesService, ResourceScope } from '../resources/resources.module';
import { Public, jwtSecret } from '../common/auth';
import { maskMsisdn, normalizeMsisdn } from '../common/phone';
import { LicenceService } from '../licence/licence.service';
import { maskEmail } from '../common/mask';
import { isOverLimit, pruneWindows, recordHit, RateWindow } from '../common/rate-window';
import { reportCardPdf, ReportCardData } from '../common/pdf';
import { balanceOf } from '../common/ledger';
import { storage } from '../common/storage';
import { SmsModule, SmsService } from '../sms/sms.module';
import { EmailModule, EmailService } from '../email/email.module';
import { renderGuardianOtp } from '../common/email-templates';

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_PER_HOUR = 5;

/**
 * How many masked "we sent it to…" answers one caller may have before the echo goes quiet.
 *
 * Set tight because going over costs nothing that matters: the code is still issued and still
 * sent, only the description of where it went is withheld. A family signing in asks once or
 * twice; a caller working through a list of numbers is done being told anything useful well
 * before the list is.
 */
const DISCLOSURE_MAX_PER_WINDOW = 10;
const DISCLOSURE_WINDOW_MS = 10 * 60_000;
/** Guardians pay per SMS, so a long session avoids charging them to re-authenticate weekly. */
const SESSION_DAYS = 30;

/**
 * A guardian session. `kind` keeps it strictly separate from a staff token — the staff guard
 * refuses anything with kind 'guardian' and this guard refuses anything without it, so neither
 * token can ever be replayed against the other's routes.
 */
export interface GuardianUser {
  sub: string; // guardianId
  schoolId: string;
  kind: 'guardian';
  name: string;
}

export const CurrentGuardian = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): GuardianUser => ctx.switchToHttp().getRequest().guardian,
);

@Injectable()
export class GuardianGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Missing token');
    let payload: GuardianUser;
    try {
      payload = jwt.verify(token, jwtSecret()) as GuardianUser;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    // A staff token must never open guardian routes, and vice versa.
    if (payload.kind !== 'guardian') throw new UnauthorizedException('Not a guardian session');
    req.guardian = payload;
    return true;
  }
}

class RequestOtpDto {
  /** A phone number or an email address — whichever the school holds for this family. */
  @IsString() @MinLength(3) identifier: string;
  /** Where to send the code. Defaults to SMS — the channel every guardian is reachable on. */
  @IsOptional() @IsIn(['sms', 'email']) channel?: 'sms' | 'email';
}
class VerifyOtpDto {
  @IsString() @MinLength(3) identifier: string;
  @IsString() @MinLength(4) code: string;
}

/**
 * The caller's address, as reported by the web app sitting in front of this API.
 *
 * Only ever used to pace the *disclosure* below, never to allow or refuse a sign-in, because the
 * header is only as trustworthy as the deployment: the proxy overwrites it with the address it
 * actually observed, so it is sound when the API is reachable only through the web app, and
 * spoofable by anyone who can reach the API directly. That is an acceptable basis for deciding
 * how chatty to be, and would not be an acceptable basis for deciding who gets in.
 */
function clientAddress(req: {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}) {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : (forwarded ?? '').split(',')[0];
  return first.trim() || req.ip || 'unknown';
}

const hashCode = (phone: string, code: string) =>
  createHash('sha256').update(`${phone}:${code}`).digest('hex');

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

@Injectable()
export class GuardianService {
  constructor(
    private db: PrismaService,
    private fees: FeesService,
    private payments: PaymentsService,
    private calendar: CalendarService,
    private resources: ResourcesService,
    private sms: SmsService,
    private email: EmailService,
    private licence: LicenceService,
  ) {}

  /**
   * Masked-disclosure budget per caller, held in memory.
   *
   * Not Redis: it is optional in this product (the payments sweep and fee reminders both degrade
   * without it), and a limit that switches itself off wherever REDIS_URL is unset is not a limit.
   * Per-process is enough for what this guards — going over costs a caller the mask, never the
   * code — so the worst a second instance does is hand out a second budget.
   */
  private readonly disclosureWindows = new Map<string, RateWindow>();

  /** Charge this caller one disclosure, and say whether they may still have one. */
  private mayDisclose(client: string): boolean {
    const now = Date.now();
    pruneWindows(this.disclosureWindows, now, DISCLOSURE_WINDOW_MS);
    const next = recordHit(this.disclosureWindows.get(client) ?? null, now, DISCLOSURE_WINDOW_MS);
    this.disclosureWindows.set(client, next);
    return !isOverLimit(next, now, DISCLOSURE_WINDOW_MS, DISCLOSURE_MAX_PER_WINDOW);
  }

  /**
   * Find the family behind whatever the caller typed.
   *
   * Email is neither unique nor indexed in the schema, and one address can sit on more than one
   * guardian row, so the newest wins — the same tie-break the phone lookup has always used.
   */
  private findByIdentifier(rawIdentifier: string) {
    const identifier = (rawIdentifier ?? '').trim();
    if (!identifier) return Promise.resolve(null);

    if (identifier.includes('@')) {
      return this.db.system.guardian.findFirst({
        where: { email: { equals: identifier, mode: 'insensitive' } },
        orderBy: { createdAt: 'desc' },
      });
    }

    const phone = normalizeMsisdn(identifier);
    if (!phone) return Promise.resolve(null);
    return this.db.system.guardian.findFirst({
      where: { phone: { contains: phone.slice(-9) } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Issue a sign-in code. Always reports success, whether or not the identifier is registered —
   * otherwise this endpoint becomes a way to test which numbers and addresses belong to parents
   * at a given school.
   */
  async requestOtp(rawIdentifier: string, channel: 'sms' | 'email' = 'sms', client = 'unknown') {
    /**
     * `channel` is echoed so the page can say "check your email" rather than guess, but it is
     * always the channel that was *asked for*, never the one that was actually used — reporting
     * the real one would turn this endpoint back into the oracle the generic response exists to
     * prevent.
     */
    const generic = { sent: true, channel, expiresInMinutes: OTP_TTL_MINUTES };

    // Spend a disclosure before doing any lookup, so the budget is charged for probes that miss
    // as well as ones that hit — otherwise a sweep costs nothing until it finds someone.
    const mayDisclose = this.mayDisclose(client);

    // No tenant yet: the identifier is how we find out which school the caller belongs to.
    // This must come first — the throttle counters below are tenant-scoped, and running them
    // before the school is known would read zero and silently disable throttling.
    const guardian = await this.findByIdentifier(rawIdentifier);
    if (!guardian) return generic;

    // The code is always keyed to the family's phone, whichever identifier they signed in with,
    // so a parent may ask by email and verify without the page having to remember which it was.
    const phone = normalizeMsisdn(guardian.phone);
    if (!phone) return generic;

    // Named and crested so a parent who has never heard of Klasio can tell the code is genuine.
    const school = await this.db.system.school.findUnique({
      where: { id: guardian.schoolId },
      select: { name: true, logoUrl: true },
    });

    /**
     * Asked for email, but the school holds no address for this family: send nothing, and issue
     * no code.
     *
     * Silent rather than explained, for the same reason an unknown number is silent — "we have
     * no email address for you" confirms the number *does* belong to a registered guardian, which
     * is precisely the oracle this endpoint refuses to be. The sign-in page hedges its wording so
     * a family in this position is not left expecting a message that cannot come.
     */
    if (channel === 'email' && !guardian.email) return generic;

    /**
     * Where the code went, masked, so a parent with two phones or a shared family address knows
     * which one to open.
     *
     * This is the one place the endpoint stops being uniform: a mask comes back for a family we
     * hold and nothing for a stranger, which is exactly the oracle the generic answer above
     * exists to deny. `mayDisclose` is what keeps that affordable — a caller working through a
     * list stops getting masks long before the list is any use, while still getting their codes,
     * so nobody is ever locked out of their own portal by a neighbour on the same carrier NAT.
     */
    const answer = mayDisclose
      ? {
          ...generic,
          sentTo: {
            phone: maskMsisdn(phone),
            email: guardian.email ? maskEmail(guardian.email) : null,
          },
        }
      : generic;

    return withTenant(guardian.schoolId, async () => {
      const since = new Date(Date.now() - 60 * 60_000);
      const recent = await this.db.guardianOtp.count({
        where: { phone, createdAt: { gte: since } },
      });
      if (recent >= OTP_MAX_PER_HOUR) return answer;

      const last = await this.db.guardianOtp.findFirst({
        where: { phone },
        orderBy: { createdAt: 'desc' },
      });
      if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
        return answer;
      }

      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await this.db.guardianOtp.create({
        data: {
          schoolId: guardian.schoolId,
          guardianId: guardian.id,
          phone,
          codeHash: hashCode(phone, code),
          expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
        },
      });

      const sendEmail = async (to: string) =>
        this.email.send({
          to,
          toName: `${guardian.firstName} ${guardian.lastName}`.trim(),
          kind: 'guardian-otp',
          message: renderGuardianOtp({
            schoolName: school?.name ?? 'your school',
            code,
            ttlMinutes: OTP_TTL_MINUTES,
            // The crest is what makes this recognisable to a parent who has never heard of
            // Klasio and is deciding whether a code in their inbox is genuine.
            crest: await this.email.loadCrest(school?.logoUrl),
          }),
        });

      if (channel === 'email') {
        // Guarded above, so this is always taken; narrowing for the compiler and harmless if the
        // guard above is ever moved.
        if (guardian.email) await sendEmail(guardian.email);
      } else {
        // Actually sends. This used to write an SmsMessage row marked SENT and call no provider
        // at all, so in production the code never reached the parent and nobody could sign in —
        // the row said SENT and the endpoint returns a deliberately generic answer, so it looked
        // fine from both ends. The plaintext code stays inside SmsService; see sendOtp.
        const smsResult = await this.sms.sendOtp({
          schoolId: guardian.schoolId,
          phone,
          code,
          ttlMinutes: OTP_TTL_MINUTES,
        });

        /**
         * Email when the SMS did not go out, for families who gave the school an address.
         *
         * A fallback rather than a second copy on purpose. Sending both every time would mean a
         * parent who reads their mail before their messages sees a code, uses it, and then gets a
         * text carrying the same code that now does nothing — support calls, not convenience. It
         * also doubles the surface a code travels over for no gain when the SMS worked.
         *
         * What makes this worth having is that SMS to Ghanaian networks fails in ways the school
         * cannot fix: an unregistered sender ID, a number that has moved networks, an exhausted
         * credit balance. Before this, any of those locked the family out of the portal entirely.
         *
         * There is deliberately no mirror of this on the email side. A family that picked email
         * is telling us where they want the code; quietly texting it instead would put a sign-in
         * credential on a channel they did not choose.
         */
        if (!smsResult.ok && guardian.email) await sendEmail(guardian.email);
      }
      // Development only. A sign-in code in a log file is a sign-in code anyone with log access
      // can use — request one for a known parent's number and you are that parent.
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[guardian OTP] ${maskMsisdn(phone)} → ${code} (${channel})`);
      }
      return answer;
    });
  }

  async verifyOtp(rawIdentifier: string, code: string) {
    // Same reason as requestOtp: resolve the school before touching tenant-scoped rows.
    const owner = await this.findByIdentifier(rawIdentifier);
    if (!owner) throw new UnauthorizedException('That code is not valid');

    // Must match the key requestOtp stored under — the family's own phone, not whatever the
    // caller typed, or a code asked for by email could never be redeemed.
    const phone = normalizeMsisdn(owner.phone);
    if (!phone) throw new UnauthorizedException('That code is not valid');

    return withTenant(owner.schoolId, () => this.verifyOtpScoped(phone, code));
  }

  private async verifyOtpScoped(phone: string, code: string) {
    const otp = await this.db.guardianOtp.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new UnauthorizedException('That code has expired — request a new one');
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException('Too many attempts — request a new code');
    }

    if (!safeEq(otp.codeHash, hashCode(phone, code.trim()))) {
      await this.db.guardianOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('That code is not valid');
    }

    // Burn the code so it cannot be reused.
    await this.db.guardianOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    const guardian = await this.db.guardian.findUniqueOrThrow({ where: { id: otp.guardianId } });

    const payload: GuardianUser = {
      sub: guardian.id,
      schoolId: guardian.schoolId,
      kind: 'guardian',
      name: `${guardian.firstName} ${guardian.lastName}`,
    };
    await this.db.audit(guardian.schoolId, null, 'guardian.login', 'Guardian', guardian.id);
    return {
      token: jwt.sign(payload, jwtSecret(), { expiresIn: `${SESSION_DAYS}d` }),
      guardian: { name: payload.name },
    };
  }

  // ── Ward-scoped reads ──────────────────────────────────────────────

  /**
   * Resolve a ward the caller is actually allowed to see. Custody-blocked links are excluded:
   * a guardian flagged BLOCKED must not reach the child's records through the portal.
   */
  private async ward(auth: GuardianUser, studentId: string) {
    const link = await this.db.studentGuardian.findFirst({
      where: {
        studentId,
        guardianId: auth.sub,
        custodyFlag: { not: 'BLOCKED' },
        student: { schoolId: auth.schoolId },
      },
      include: { student: { include: { classRoom: { select: { name: true } } } } },
    });
    if (!link) throw new ForbiddenException('That is not your ward');
    return link.student;
  }

  /**
   * A receipt for one of the caller's own wards. `ward()` proves the child is theirs and not
   * custody-blocked; the studentId is then passed down so the payment must also belong to that
   * child — a guardian cannot fetch a receipt by guessing another family's reference.
   */
  async wardReceiptPdf(auth: GuardianUser, studentId: string, reference: string) {
    const student = await this.ward(auth, studentId);
    return this.fees.receiptPdf(auth.schoolId, reference, student.id);
  }

  /**
   * A guardian telling the school that today's arrangement is changing. It is a request, not an
   * instruction: nothing about the pickup rules changes until the front office approves it.
   */
  /**
   * Let a parent settle a bill from the portal.
   *
   * `ward()` is the whole security boundary here: it proves the child belongs to this guardian
   * and is not custody-BLOCKED. Everything downstream trusts that, so it must stay first.
   *
   * The amount is deliberately not taken from the client. A guardian may choose to pay less than
   * the full balance, but never more than is owed, and never against another child.
   */
  async checkout(
    auth: GuardianUser,
    studentId: string,
    body: { amount?: number; channel?: 'MOMO' | 'CARD'; phone?: string },
  ) {
    await this.ward(auth, studentId);
    const owed = await this.payments.outstandingFor(studentId);
    if (!(owed > 0)) throw new BadRequestException('There is nothing outstanding on this account');
    const amount = body.amount ?? owed;
    if (amount <= 0) throw new BadRequestException('Enter an amount to pay');
    if (amount > owed) {
      throw new BadRequestException(
        `That is more than is owed — the balance is ${owed.toFixed(2)}`,
      );
    }
    return this.payments.guardianCheckout(auth.schoolId, {
      studentId,
      amount,
      channel: body.channel ?? 'MOMO',
      phone: body.phone,
    });
  }

  async requestDismissalChange(
    auth: GuardianUser,
    studentId: string,
    forDate: string,
    details: string,
  ) {
    const student = await this.ward(auth, studentId);
    const req = await this.db.dismissalRequest.create({
      data: {
        schoolId: auth.schoolId,
        studentId: student.id,
        guardianId: auth.sub,
        forDate: new Date(forDate),
        details,
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'pickup.dismissal.request',
      'Student',
      student.id,
      {
        forDate,
      },
    );
    return { id: req.id, status: req.status };
  }

  // ── Car line ───────────────────────────────────────────────────────

  /**
   * Guardian routes bypass the staff guard, so the entitlement is asked here. NotFound rather
   * than Forbidden: to a family on a package without the car line, the feature does not exist.
   */
  private assertCarLine() {
    if (!this.licence.entitlements().includes('safety.carline')) {
      throw new NotFoundException('The car line is not available');
    }
  }

  private carLineDayStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** "I am outside" — one live entry per guardian per day; announcing twice returns the first. */
  async announceArrival(auth: GuardianUser) {
    this.assertCarLine();
    const existing = await this.db.carLineEntry.findFirst({
      where: {
        guardianId: auth.sub,
        schoolId: auth.schoolId,
        status: { in: ['WAITING', 'CALLED'] },
        announcedAt: { gte: this.carLineDayStart() },
      },
    });
    if (!existing) {
      await this.db.carLineEntry.create({
        data: { schoolId: auth.schoolId, guardianId: auth.sub },
      });
      await this.db.audit(auth.schoolId, auth.sub, 'carline.announce', 'Guardian', auth.sub);
    }
    return this.myCarLine(auth);
  }

  /** Where the family stands in the queue right now. */
  async myCarLine(auth: GuardianUser) {
    this.assertCarLine();
    const entry = await this.db.carLineEntry.findFirst({
      where: {
        guardianId: auth.sub,
        schoolId: auth.schoolId,
        announcedAt: { gte: this.carLineDayStart() },
        status: { in: ['WAITING', 'CALLED'] },
      },
    });
    if (!entry) return { entry: null, position: null };
    const ahead = await this.db.carLineEntry.count({
      where: {
        schoolId: auth.schoolId,
        status: 'WAITING',
        announcedAt: { gte: this.carLineDayStart(), lt: entry.announcedAt },
      },
    });
    return {
      entry: { id: entry.id, status: entry.status, announcedAt: entry.announcedAt },
      position: entry.status === 'CALLED' ? 0 : ahead + 1,
    };
  }

  /** Changed plans — leave the queue rather than being a phantom the staff wait on. */
  async cancelArrival(auth: GuardianUser) {
    this.assertCarLine();
    await this.db.carLineEntry.updateMany({
      where: {
        guardianId: auth.sub,
        schoolId: auth.schoolId,
        status: 'WAITING',
        announcedAt: { gte: this.carLineDayStart() },
      },
      data: { status: 'CANCELLED', doneAt: new Date() },
    });
    return { ok: true };
  }

  async myDismissalRequests(auth: GuardianUser) {
    const requests = await this.db.dismissalRequest.findMany({
      where: { guardianId: auth.sub, schoolId: auth.schoolId },
      include: { student: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return requests.map((r) => ({
      id: r.id,
      student: `${r.student.firstName} ${r.student.lastName}`,
      forDate: r.forDate,
      details: r.details,
      status: r.status,
      decisionNote: r.decisionNote,
    }));
  }

  async me(auth: GuardianUser) {
    const [links, school] = await Promise.all([
      this.db.studentGuardian.findMany({
        where: {
          guardianId: auth.sub,
          custodyFlag: { not: 'BLOCKED' },
          student: { schoolId: auth.schoolId },
        },
        include: { student: { include: { classRoom: { select: { name: true } } } } },
      }),
      this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } }),
    ]);
    return {
      guardian: { name: auth.name },
      school: { name: school.name, phone: school.phone, currency: school.currency },
      wards: links.map((l) => ({
        id: l.student.id,
        name: `${l.student.firstName} ${l.student.lastName}`,
        admissionNo: l.student.admissionNo,
        className: l.student.classRoom?.name ?? null,
        status: l.student.status,
      })),
    };
  }

  /** Bills, payments and attendance for one ward — read-only. */
  async wardOverview(auth: GuardianUser, studentId: string) {
    const student = await this.ward(auth, studentId);
    const [ledger, attendance] = await Promise.all([
      this.db.ledgerEntry.findMany({
        where: { studentId },
        orderBy: { createdAt: 'desc' },
        include: { receipt: { select: { number: true } } },
      }),
      this.db.attendanceRecord.groupBy({
        by: ['status'],
        where: { studentId },
        _count: true,
      }),
    ]);
    const balance = balanceOf(ledger);
    return {
      student: {
        name: `${student.firstName} ${student.lastName}`,
        admissionNo: student.admissionNo,
        className: student.classRoom?.name ?? null,
      },
      feeBalance: Math.round(balance * 100) / 100,
      ledger: ledger.slice(0, 30).map((e) => ({
        id: e.id,
        type: e.type,
        amount: Number(e.amount),
        method: e.method,
        reference: e.reference,
        receiptNumber: e.receipt?.number ?? null,
        createdAt: e.createdAt,
      })),
      attendance: attendance.reduce(
        (acc, a) => ({ ...acc, [a.status]: a._count }),
        {} as Record<string, number>,
      ),
    };
  }

  /** Only published reports are ever visible to a guardian. */
  async wardReports(auth: GuardianUser, studentId: string) {
    await this.ward(auth, studentId);
    const reports = await this.db.termReport.findMany({
      where: { studentId, publishedAt: { not: null } },
      orderBy: { generatedAt: 'desc' },
    });
    const terms = await this.db.term.findMany({
      where: { id: { in: reports.map((r) => r.termId) } },
      include: { academicYear: { select: { name: true } } },
    });
    const termById = new Map(terms.map((t) => [t.id, t]));
    return reports.map((r) => ({
      termId: r.termId,
      term: termById.get(r.termId)?.name ?? '',
      year: termById.get(r.termId)?.academicYear.name ?? '',
      overallTotal: r.overallTotal,
      classPosition: r.classPosition,
      classSize: r.classSize,
      publishedAt: r.publishedAt,
    }));
  }

  private async publishedCard(auth: GuardianUser, studentId: string, termId: string) {
    const student = await this.ward(auth, studentId);
    const report = await this.db.termReport.findFirst({
      where: { studentId, termId, schoolId: auth.schoolId, publishedAt: { not: null } },
    });
    if (!report) throw new NotFoundException('That report has not been published');

    const [school, term, level] = await Promise.all([
      this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } }),
      this.db.term.findFirst({
        where: { id: termId },
        include: { academicYear: { select: { name: true } } },
      }),
      this.db.classRoom.findFirst({
        where: { id: report.classId },
        include: { level: { include: { gradingScheme: true } } },
      }),
    ]);
    const scheme =
      level?.level.gradingScheme ??
      (await this.db.gradingScheme.findFirst({
        where: { schoolId: auth.schoolId, kind: 'GES_CLASSIC' },
      }));
    return {
      schemeKind: scheme?.kind ?? 'GES_CLASSIC',
      template: school.reportTemplate,
      school: {
        name: school.name,
        motto: school.motto,
        address: school.address,
        phone: school.phone,
        // The parent's copy must be the same document as the school's. Without these it fell back
        // to 30/70 and the default green, so a school on 40/60 printed "Class (40%)" while the
        // parent downloaded "Class (30%)" over identical marks — and lost the crest.
        brandColor: school.brandColor,
        // Bytes, not the storage key — and a crest that cannot be read must not stop a parent
        // getting the report card, so a failed fetch degrades to no logo.
        logo: school.logoUrl
          ? await storage()
              .get(school.logoUrl)
              .catch(() => null)
          : null,
      },
      weights: {
        sba: school.sbaWeight ?? 30,
        exam: school.examWeight ?? 70,
      },
      student: {
        name: `${student.firstName} ${student.lastName}`,
        admissionNo: student.admissionNo,
        className: student.classRoom?.name ?? null,
      },
      term: {
        name: term?.name,
        year: term?.academicYear.name,
        nextTermBegins: term?.nextTermBegins ?? null,
      },
      lines: report.lines,
      overallTotal: report.overallTotal,
      classPosition: report.classPosition,
      classSize: report.classSize,
      attendance: { present: report.attendancePresent, total: report.attendanceTotal },
      conduct: report.conduct,
      interest: report.interest,
      teacherRemark: report.teacherRemark,
      headRemark: report.headRemark,
    };
  }

  reportCard(auth: GuardianUser, studentId: string, termId: string) {
    return this.publishedCard(auth, studentId, termId);
  }

  async reportCardPdf(auth: GuardianUser, studentId: string, termId: string) {
    const card = await this.publishedCard(auth, studentId, termId);
    return reportCardPdf(card as unknown as ReportCardData);
  }

  async announcements(auth: GuardianUser) {
    const { classIds, levelIds } = await this.scope(auth);
    const routeIds = await this.routeScope(auth);
    const notices = await this.db.announcement.findMany({
      where: {
        schoolId: auth.schoolId,
        audience: { in: ['ALL', 'GUARDIANS'] },
        /**
         * A notice with no class, level or route is for the whole school; one with any of them
         * is for those families only. This is what makes "one class" true of the notice board
         * and not just of the text message — before it, every targeted broadcast was also posted
         * to every family's board.
         */
        OR: [
          { classId: null, levelId: null, routeId: null },
          { classId: { in: classIds } },
          { levelId: { in: levelIds } },
          { routeId: { in: routeIds } },
        ],
      },
      orderBy: { publishedAt: 'desc' },
      take: 30,
    });
    return notices.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      publishedAt: n.publishedAt,
    }));
  }

  /**
   * The classes and levels the caller's own wards sit in. Custody-blocked links are left out
   * here for the same reason as everywhere else: that guardian is not part of the child's
   * school life, so the child's class shelf is not theirs to read either.
   */
  /** The bus routes the caller's own wards ride — the transport half of a notice's audience. */
  private async routeScope(auth: GuardianUser): Promise<string[]> {
    const riders = await this.db.transportRider.findMany({
      where: {
        student: {
          schoolId: auth.schoolId,
          guardians: { some: { guardianId: auth.sub, custodyFlag: { not: 'BLOCKED' } } },
        },
      },
      select: { routeId: true },
    });
    return [...new Set(riders.map((r) => r.routeId))];
  }

  private async scope(auth: GuardianUser): Promise<ResourceScope> {
    const links = await this.db.studentGuardian.findMany({
      where: {
        guardianId: auth.sub,
        custodyFlag: { not: 'BLOCKED' },
        student: { schoolId: auth.schoolId },
      },
      select: { student: { select: { classId: true, classRoom: { select: { levelId: true } } } } },
    });
    const classIds = links.map((l) => l.student.classId).filter((id): id is string => !!id);
    const levelIds = links
      .map((l) => l.student.classRoom?.levelId)
      .filter((id): id is string => !!id);
    return { classIds, levelIds };
  }

  /** Whole-school and guardian-facing events only — never anything written for staff. */
  async calendarEvents(auth: GuardianUser) {
    const { levelIds } = await this.scope(auth);
    return this.calendar.feed(auth.schoolId, 'GUARDIANS', levelIds);
  }

  async learningResources(auth: GuardianUser) {
    return this.resources.feed(auth.schoolId, await this.scope(auth));
  }

  /** Re-checks the scope on the way out, so a guessed id fetches nothing. */
  async resourceFile(auth: GuardianUser, id: string) {
    return this.resources.download(
      auth.schoolId,
      id,
      { guardianId: auth.sub },
      await this.scope(auth),
    );
  }
}

@Controller('guardian')
export class GuardianAuthController {
  constructor(private svc: GuardianService) {}

  @Post('auth/request-otp')
  @Public()
  requestOtp(
    @Body() dto: RequestOtpDto,
    @Req() req: { headers: Record<string, string | string[] | undefined>; ip?: string },
  ) {
    return this.svc.requestOtp(dto.identifier, dto.channel, clientAddress(req));
  }

  @Post('auth/verify')
  @Public()
  verify(@Body() dto: VerifyOtpDto) {
    if (!dto.code?.trim()) throw new BadRequestException('Enter the code');
    return this.svc.verifyOtp(dto.identifier, dto.code);
  }
}

/** Everything here is read-only and scoped to the caller's own wards. */
@Controller('guardian')
@Public() // bypasses the staff guard; GuardianGuard authenticates instead
@UseGuards(GuardianGuard)
export class GuardianPortalController {
  constructor(private svc: GuardianService) {}

  @Get('me')
  me(@CurrentGuardian() g: GuardianUser) {
    return this.svc.me(g);
  }

  @Get('wards/:studentId')
  ward(@CurrentGuardian() g: GuardianUser, @Param('studentId') studentId: string) {
    return this.svc.wardOverview(g, studentId);
  }

  @Get('wards/:studentId/reports')
  reports(@CurrentGuardian() g: GuardianUser, @Param('studentId') studentId: string) {
    return this.svc.wardReports(g, studentId);
  }

  @Get('wards/:studentId/reports/:termId')
  report(
    @CurrentGuardian() g: GuardianUser,
    @Param('studentId') studentId: string,
    @Param('termId') termId: string,
  ) {
    return this.svc.reportCard(g, studentId, termId);
  }

  @Post('wards/:studentId/checkout')
  checkout(
    @CurrentGuardian() g: GuardianUser,
    @Param('studentId') studentId: string,
    @Body() body: { amount?: number; channel?: 'MOMO' | 'CARD'; phone?: string },
  ) {
    return this.svc.checkout(g, studentId, body);
  }

  @Post('wards/:studentId/dismissal-requests')
  requestDismissal(
    @CurrentGuardian() g: GuardianUser,
    @Param('studentId') studentId: string,
    @Body() body: { forDate: string; details: string },
  ) {
    return this.svc.requestDismissalChange(g, studentId, body.forDate, body.details);
  }

  @Post('carline')
  announceArrival(@CurrentGuardian() g: GuardianUser) {
    return this.svc.announceArrival(g);
  }

  @Get('carline')
  myCarLine(@CurrentGuardian() g: GuardianUser) {
    return this.svc.myCarLine(g);
  }

  @Delete('carline')
  cancelArrival(@CurrentGuardian() g: GuardianUser) {
    return this.svc.cancelArrival(g);
  }

  @Get('dismissal-requests')
  myDismissals(@CurrentGuardian() g: GuardianUser) {
    return this.svc.myDismissalRequests(g);
  }

  @Get('wards/:studentId/receipts/:reference/pdf')
  async receiptPdf(
    @CurrentGuardian() g: GuardianUser,
    @Param('studentId') studentId: string,
    @Param('reference') reference: string,
  ) {
    const buf = await this.svc.wardReceiptPdf(g, studentId, reference);
    return new StreamableFile(buf, {
      type: 'application/pdf',
      disposition: `attachment; filename="receipt-${reference}.pdf"`,
    });
  }

  @Get('wards/:studentId/reports/:termId/pdf')
  async reportPdf(
    @CurrentGuardian() g: GuardianUser,
    @Param('studentId') studentId: string,
    @Param('termId') termId: string,
  ) {
    const buf = await this.svc.reportCardPdf(g, studentId, termId);
    return new StreamableFile(buf, {
      type: 'application/pdf',
      disposition: `attachment; filename="report-${termId}.pdf"`,
    });
  }

  @Get('notices')
  notices(@CurrentGuardian() g: GuardianUser) {
    return this.svc.announcements(g);
  }

  @Get('calendar')
  calendar(@CurrentGuardian() g: GuardianUser) {
    return this.svc.calendarEvents(g);
  }

  @Get('resources')
  resources(@CurrentGuardian() g: GuardianUser) {
    return this.svc.learningResources(g);
  }

  @Get('resources/:id/file')
  async resourceFile(@CurrentGuardian() g: GuardianUser, @Param('id') id: string) {
    // Streamed, not buffered — a shared lesson video must not transit the heap per reader.
    return ResourcesService.asFile(await this.svc.resourceFile(g, id));
  }
}

@Module({
  imports: [FeesModule, PaymentsModule, CalendarModule, ResourcesModule, SmsModule, EmailModule],
  controllers: [GuardianAuthController, GuardianPortalController],
  providers: [GuardianService, GuardianGuard],
})
export class GuardianModule {}
