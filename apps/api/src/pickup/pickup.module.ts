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
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsDateString, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireEntitlement, RequirePermission } from '../common/auth';
import { renderMessage } from '../common/templates';
import { SmsModule, SmsService } from '../sms/sms.module';
import {
  assessCollector,
  overrideReasonValid,
  verdictMessage,
  type Collector,
  type CollectorKind,
} from '../common/pickup';
import { pickupCardPdf } from '../common/pdf';
import { objectKey, storage } from '../common/storage';

const BCRYPT_ROUNDS = 10;

class DelegateDto {
  @IsString() @MinLength(2) name: string;
  @IsString() phone: string;
  @IsString() @MinLength(2) relationship: string;
  @IsOptional() @IsDateString() expiresAt?: string;
}

class VerifyDto {
  @IsString() studentId: string;
  /** From a scanned QR. */
  @IsOptional() @IsString() token?: string;
  /** Fallback for a guardian without a smartphone. */
  @IsOptional() @IsString() pin?: string;
  @IsOptional() @IsString() collectorId?: string;
  @IsOptional() @IsIn(['GUARDIAN', 'DELEGATE']) collectorKind?: CollectorKind;
}

class ReleaseDto extends VerifyDto {
  @IsOptional() @IsString() overrideReason?: string;
  /**
   * Idempotency key from the gate device.
   *
   * Present when the release was queued offline and is being replayed. Without it a dropped
   * response would make the device retry and log the same child leaving twice.
   */
  @IsOptional() @IsString() clientRef?: string;
}

class CheckInDto {
  @IsString() studentId: string;
  /** Optional identification of who brought the child (QR scan or named at the gate). */
  @IsOptional() @IsString() token?: string;
  @IsOptional() @IsString() collectorId?: string;
  @IsOptional() @IsIn(['GUARDIAN', 'DELEGATE']) collectorKind?: CollectorKind;
  /** Free-text name when the person is not on file — a neighbour, an older sibling. */
  @IsOptional() @IsString() broughtBy?: string;
  /** Idempotency key from the gate device; see ReleaseDto.clientRef. */
  @IsOptional() @IsString() clientRef?: string;
}

class DismissalRequestDto {
  @IsString() studentId: string;
  @IsDateString() forDate: string;
  @IsString() @MinLength(6) details: string;
}

class DismissalDecisionDto {
  @IsIn(['APPROVED', 'DECLINED']) status: 'APPROVED' | 'DECLINED';
  @IsOptional() @IsString() decisionNote?: string;
}

/** Start of the school day, so "today's releases" means today. */
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Minimal shape of a Multer upload — avoids depending on @types/multer, as elsewhere. */
interface UploadedPhoto {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

const PHOTO_TYPES = ['image/jpeg', 'image/png'];

@Injectable()
export class PickupService {
  constructor(
    private db: PrismaService,
    private sms: SmsService,
  ) {}

  private async ownStudent(auth: AuthUser, studentId: string) {
    const student = await this.db.student.findFirst({
      where: { id: studentId, schoolId: auth.schoolId },
      include: { classRoom: { select: { name: true } } },
    });
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  // ── Authorised list ────────────────────────────────────────────────

  /** Everyone who may collect this child, with the standing verdict for each. */
  async authorised(auth: AuthUser, studentId: string) {
    await this.ownStudent(auth, studentId);
    const now = new Date();
    const [links, delegates] = await Promise.all([
      this.db.studentGuardian.findMany({
        where: { studentId },
        include: { guardian: { include: { pickupCredential: true } } },
      }),
      this.db.pickupDelegate.findMany({
        where: { studentId, schoolId: auth.schoolId, active: true },
        include: { credential: true },
      }),
    ]);

    const guardians = links.map((l) => {
      const collector: Collector = {
        kind: 'GUARDIAN',
        custodyFlag: l.custodyFlag,
        authorised: l.canPickup,
      };
      const verdict = assessCollector(collector, now);
      return {
        kind: 'GUARDIAN' as const,
        id: l.guardianId,
        name: `${l.guardian.firstName} ${l.guardian.lastName}`,
        phone: l.guardian.phone,
        relationship: l.relationship,
        custodyFlag: l.custodyFlag,
        canPickup: l.canPickup,
        hasCard: !!l.guardian.pickupCredential && !l.guardian.pickupCredential.revokedAt,
        // Gate staff compare a face to this at handoff, so the UI needs to know when it is
        // missing — the release screen was rendering a permanently broken image because nothing
        // in the product could ever upload one.
        hasPhoto: !!l.guardian.photoUrl,
        verdict,
        message: verdictMessage(verdict),
      };
    });

    const others = delegates.map((d) => {
      const collector: Collector = {
        kind: 'DELEGATE',
        authorised: d.active,
        expiresAt: d.expiresAt,
      };
      const verdict = assessCollector(collector, now);
      return {
        kind: 'DELEGATE' as const,
        id: d.id,
        name: d.name,
        phone: d.phone,
        relationship: d.relationship,
        expiresAt: d.expiresAt,
        hasCard: !!d.credential && !d.credential.revokedAt,
        hasPhoto: !!d.photoUrl,
        verdict,
        message: verdictMessage(verdict),
      };
    });

    return { guardians, delegates: others };
  }

  async addDelegate(auth: AuthUser, studentId: string, dto: DelegateDto) {
    await this.ownStudent(auth, studentId);
    // "Just this term" is how these arrangements really work, so a delegate added without a
    // date expires with the current term rather than standing forever. With no term configured
    // yet, ninety days keeps the default finite.
    let expiresAt: Date;
    if (dto.expiresAt) {
      expiresAt = new Date(dto.expiresAt);
    } else {
      const term = await this.db.term.findFirst({
        where: { isCurrent: true, academicYear: { schoolId: auth.schoolId, isCurrent: true } },
        select: { endDate: true },
      });
      expiresAt =
        term && term.endDate > new Date()
          ? term.endDate
          : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    }
    const delegate = await this.db.pickupDelegate.create({
      data: {
        schoolId: auth.schoolId,
        studentId,
        name: dto.name,
        phone: dto.phone,
        relationship: dto.relationship,
        expiresAt,
        createdById: auth.sub,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'pickup.delegate.add', 'Student', studentId, {
      name: dto.name,
      relationship: dto.relationship,
      expiresAt: expiresAt.toISOString(),
    });
    return { id: delegate.id, expiresAt };
  }

  async removeDelegate(auth: AuthUser, id: string) {
    const delegate = await this.db.pickupDelegate.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!delegate) throw new NotFoundException('Delegate not found');
    // Deactivated rather than deleted: past releases must still name who collected.
    await this.db.pickupDelegate.update({ where: { id }, data: { active: false } });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'pickup.delegate.remove',
      'Student',
      delegate.studentId,
      { name: delegate.name },
    );
    return { ok: true };
  }

  // ── Credentials ────────────────────────────────────────────────────

  /**
   * Issue (or rotate) a gate pass. The PIN is shown once, here, and never again — it is
   * stored hashed, exactly like a password, because it opens a door to a child.
   */
  async issueCard(auth: AuthUser, kind: CollectorKind, id: string) {
    if (kind === 'GUARDIAN') {
      const guardian = await this.db.guardian.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!guardian) throw new NotFoundException('Guardian not found');
    } else {
      const delegate = await this.db.pickupDelegate.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!delegate) throw new NotFoundException('Delegate not found');
    }

    const token = randomBytes(24).toString('base64url');
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const data = {
      schoolId: auth.schoolId,
      token,
      pinHash: await bcrypt.hash(pin, BCRYPT_ROUNDS),
      issuedAt: new Date(),
      revokedAt: null,
    };

    await this.db.pickupCredential.upsert({
      where: kind === 'GUARDIAN' ? { guardianId: id } : { delegateId: id },
      create: { ...data, ...(kind === 'GUARDIAN' ? { guardianId: id } : { delegateId: id }) },
      update: data,
    });
    await this.db.audit(auth.schoolId, auth.sub, 'pickup.card.issue', kind, id);
    // The only time the PIN is visible.
    return { token, pin };
  }

  async revokeCard(auth: AuthUser, kind: CollectorKind, id: string) {
    const where = kind === 'GUARDIAN' ? { guardianId: id } : { delegateId: id };
    const cred = await this.db.pickupCredential.findFirst({
      where: { ...where, schoolId: auth.schoolId },
    });
    if (!cred) throw new NotFoundException('No card issued');
    await this.db.pickupCredential.update({
      where: { id: cred.id },
      data: { revokedAt: new Date() },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'pickup.card.revoke', kind, id);
    return { ok: true };
  }

  /** Printed card: QR plus the PIN, for a guardian without a smartphone. */
  async cardPdf(auth: AuthUser, kind: CollectorKind, id: string, pin: string) {
    const school = await this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } });
    const cred = await this.db.pickupCredential.findFirst({
      where:
        kind === 'GUARDIAN'
          ? { guardianId: id, schoolId: auth.schoolId }
          : { delegateId: id, schoolId: auth.schoolId },
    });
    if (!cred || cred.revokedAt) throw new NotFoundException('No active card for this person');

    let holder: string;
    let children: string[];
    if (kind === 'GUARDIAN') {
      const g = await this.db.guardian.findUniqueOrThrow({
        where: { id },
        include: { students: { include: { student: true } } },
      });
      holder = `${g.firstName} ${g.lastName}`;
      children = g.students.map((s) => `${s.student.firstName} ${s.student.lastName}`);
    } else {
      const d = await this.db.pickupDelegate.findUniqueOrThrow({
        where: { id },
        include: { student: true },
      });
      holder = d.name;
      children = [`${d.student.firstName} ${d.student.lastName}`];
    }

    return pickupCardPdf({
      school: {
        name: school.name,
        motto: school.motto,
        address: school.address,
        phone: school.phone,
        brandColor: school.brandColor,
        // A crest that cannot be read must not stop a pass being issued.
        logo: school.logoUrl
          ? await storage()
              .get(school.logoUrl)
              .catch(() => null)
          : null,
      },
      holder,
      children,
      token: cred.token,
      pin,
    });
  }

  // ── Verification & release ─────────────────────────────────────────

  /**
   * Work out who is at the gate and whether they may take this child. Read-only: it decides
   * nothing, so the front desk can see the verdict before committing to it.
   */
  async verify(auth: AuthUser, dto: VerifyDto) {
    const student = await this.ownStudent(auth, dto.studentId);
    const now = new Date();

    let kind: CollectorKind;
    let id: string;
    let method: 'QR' | 'PIN' | 'MANUAL';

    if (dto.token) {
      const cred = await this.db.pickupCredential.findFirst({
        where: { token: dto.token, schoolId: auth.schoolId, revokedAt: null },
      });
      if (!cred) throw new BadRequestException('That card is not recognised or has been revoked');
      kind = cred.guardianId ? 'GUARDIAN' : 'DELEGATE';
      id = (cred.guardianId ?? cred.delegateId)!;
      method = 'QR';
    } else if (dto.pin && dto.collectorId && dto.collectorKind) {
      const cred = await this.db.pickupCredential.findFirst({
        where:
          dto.collectorKind === 'GUARDIAN'
            ? { guardianId: dto.collectorId, schoolId: auth.schoolId, revokedAt: null }
            : { delegateId: dto.collectorId, schoolId: auth.schoolId, revokedAt: null },
      });
      if (!cred || !(await bcrypt.compare(dto.pin, cred.pinHash))) {
        throw new BadRequestException('That PIN does not match');
      }
      kind = dto.collectorKind;
      id = dto.collectorId;
      method = 'PIN';
    } else if (dto.collectorId && dto.collectorKind) {
      // Named at the desk with no card presented — legitimate, just not scanned.
      kind = dto.collectorKind;
      id = dto.collectorId;
      method = 'MANUAL';
    } else {
      throw new BadRequestException('Scan a card, enter a PIN, or choose who is collecting');
    }

    const { collector, name, phone, hasPhoto } = await this.loadCollector(
      auth,
      kind,
      id,
      dto.studentId,
    );
    const verdict = assessCollector(collector, now);

    const released = await this.db.releaseLog.findFirst({
      where: { studentId: dto.studentId, releasedAt: { gte: startOfDay(now) } },
    });

    return {
      student: {
        id: student.id,
        name: `${student.firstName} ${student.lastName}`,
        admissionNo: student.admissionNo,
        className: student.classRoom?.name ?? null,
        photoUrl: student.photoUrl,
      },
      // hasPhoto rather than the photo itself: the face is fetched by a separate authenticated
      // request, so a verify response can be logged or cached without carrying someone's picture.
      collector: { kind, id, name, phone, hasPhoto },
      method,
      verdict,
      message: verdictMessage(verdict),
      alreadyReleasedToday: released
        ? { collectedBy: released.collectedBy, at: released.releasedAt }
        : null,
    };
  }

  private async loadCollector(
    auth: AuthUser,
    kind: CollectorKind,
    id: string,
    studentId: string,
  ): Promise<{ collector: Collector; name: string; phone: string; hasPhoto: boolean }> {
    if (kind === 'GUARDIAN') {
      const link = await this.db.studentGuardian.findUnique({
        where: { studentId_guardianId: { studentId, guardianId: id } },
        include: { guardian: true },
      });
      if (!link) {
        // A guardian of another child entirely: recognised, but not on this child's list.
        const g = await this.db.guardian.findFirst({ where: { id, schoolId: auth.schoolId } });
        if (!g) throw new NotFoundException('Person not found');
        return {
          collector: { kind, authorised: false, custodyFlag: 'NONE' },
          name: `${g.firstName} ${g.lastName}`,
          phone: g.phone,
          hasPhoto: !!g.photoUrl,
        };
      }
      return {
        collector: { kind, authorised: link.canPickup, custodyFlag: link.custodyFlag },
        name: `${link.guardian.firstName} ${link.guardian.lastName}`,
        phone: link.guardian.phone,
        hasPhoto: !!link.guardian.photoUrl,
      };
    }
    const d = await this.db.pickupDelegate.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!d) throw new NotFoundException('Person not found');
    return {
      collector: {
        kind,
        authorised: d.active && d.studentId === studentId,
        expiresAt: d.expiresAt,
      },
      name: d.name,
      phone: d.phone,
      hasPhoto: !!d.photoUrl,
    };
  }

  /**
   * Release the child and write the log. The log entry is the point of the whole module, so it
   * is written before anything that can fail (the notification) is attempted.
   */
  async release(auth: AuthUser, dto: ReleaseDto) {
    // Replay check first, before anything else. A queued release is replayed precisely because
    // the device never saw our answer, so the row may already exist — and re-running the
    // verification would then fail on "already collected today", turning a successful release
    // into an error the gate staff cannot act on.
    if (dto.clientRef) {
      const existing = await this.db.releaseLog.findFirst({
        where: { schoolId: auth.schoolId, clientRef: dto.clientRef },
      });
      if (existing) {
        return {
          released: true,
          replayed: true,
          collectedBy: existing.collectedBy,
          at: existing.releasedAt,
        };
      }
    }

    const check = await this.verify(auth, dto);

    if (!check.verdict.allowed) {
      throw new ForbiddenException(check.message);
    }
    if (check.verdict.requiresOverride && !overrideReasonValid(dto.overrideReason)) {
      throw new BadRequestException(
        `${check.message} To release anyway, record a reason (at least a few words).`,
      );
    }
    if (check.alreadyReleasedToday) {
      throw new BadRequestException(
        `${check.student.name} was already collected today by ${check.alreadyReleasedToday.collectedBy}.`,
      );
    }

    const log = await this.db.releaseLog.create({
      data: {
        schoolId: auth.schoolId,
        studentId: dto.studentId,
        collectedBy: check.collector.name,
        collectorKind: check.collector.kind,
        collectorId: check.collector.id,
        // How they were identified, and separately whether advice was overridden.
        method: check.method,
        overrideReason: check.verdict.requiresOverride ? dto.overrideReason : null,
        releasedById: auth.sub,
        clientRef: dto.clientRef ?? null,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'pickup.release', 'Student', dto.studentId, {
      collectedBy: check.collector.name,
      method: log.method,
      override: check.verdict.requiresOverride ? dto.overrideReason : undefined,
    });

    const notified = await this.notifyRelease(auth, dto.studentId, check.collector.name, log.id);
    return {
      id: log.id,
      student: check.student.name,
      collectedBy: check.collector.name,
      method: log.method,
      releasedAt: log.releasedAt,
      notified,
    };
  }

  /** Tell the primary guardian their child has gone, and with whom. */
  private async notifyRelease(
    auth: AuthUser,
    studentId: string,
    collectedBy: string,
    logId: string,
  ) {
    const [student, school] = await Promise.all([
      this.db.student.findUniqueOrThrow({
        where: { id: studentId },
        include: {
          guardians: {
            where: { isPrimary: true, custodyFlag: { not: 'BLOCKED' } },
            include: { guardian: { select: { phone: true } } },
          },
        },
      }),
      this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } }),
    ]);
    const phone = student.guardians[0]?.guardian.phone;
    if (!phone) return 0;
    const at = new Date().toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' });
    const res = await this.sms.sendToPhones({
      schoolId: auth.schoolId,
      createdById: auth.sub,
      phones: [phone],
      body: await renderMessage(this.db, auth.schoolId, 'PICKUP_RELEASED', {
        school: school.name,
        student: `${student.firstName} ${student.lastName}`,
        collector: collectedBy,
        time: at,
      }),
      batchId: `PICKUP-${logId}`,
    });
    return res.sent;
  }

  /** The day's releases — who left, with whom, and anything released against advice. */
  async log(auth: AuthUser, date?: string) {
    const from = startOfDay(date ? new Date(date) : new Date());
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    const entries = await this.db.releaseLog.findMany({
      where: { schoolId: auth.schoolId, releasedAt: { gte: from, lt: to } },
      include: {
        student: {
          select: {
            firstName: true,
            lastName: true,
            admissionNo: true,
            classRoom: { select: { name: true } },
          },
        },
      },
      orderBy: { releasedAt: 'desc' },
    });
    return entries.map((e) => ({
      id: e.id,
      student: `${e.student.firstName} ${e.student.lastName}`,
      admissionNo: e.student.admissionNo,
      className: e.student.classRoom?.name ?? '—',
      collectedBy: e.collectedBy,
      collectorKind: e.collectorKind,
      method: e.method,
      overrideReason: e.overrideReason,
      releasedAt: e.releasedAt,
    }));
  }

  // ── Morning check-in ───────────────────────────────────────────────

  /**
   * Record a child arriving. The mirror of release, with two deliberate differences: custody
   * verdicts do not gate an arrival (they govern who may take a child away, not who may bring
   * one), and identification is optional because a JHS pupil walks in alone.
   */
  async checkIn(auth: AuthUser, dto: CheckInDto) {
    // Replay first, same as release: a queued check-in is replayed precisely because the
    // device never saw our answer.
    if (dto.clientRef) {
      const existing = await this.db.checkInLog.findFirst({
        where: { schoolId: auth.schoolId, clientRef: dto.clientRef },
      });
      if (existing) {
        return { checkedIn: true, replayed: true, at: existing.checkedInAt };
      }
    }

    const student = await this.ownStudent(auth, dto.studentId);

    const already = await this.db.checkInLog.findFirst({
      where: { studentId: dto.studentId, checkedInAt: { gte: startOfDay() } },
    });
    if (already) {
      throw new BadRequestException(
        `${student.firstName} ${student.lastName} was already checked in today at ${already.checkedInAt.toLocaleTimeString(
          'en-GH',
          { hour: '2-digit', minute: '2-digit' },
        )}.`,
      );
    }

    let broughtBy: string | null = dto.broughtBy?.trim() || null;
    let collectorKind: CollectorKind | null = null;
    let collectorId: string | null = null;
    let method: 'QR' | 'MANUAL' = 'MANUAL';

    if (dto.token) {
      const cred = await this.db.pickupCredential.findFirst({
        where: { token: dto.token, schoolId: auth.schoolId, revokedAt: null },
      });
      if (!cred) throw new BadRequestException('That card is not recognised or has been revoked');
      collectorKind = cred.guardianId ? 'GUARDIAN' : 'DELEGATE';
      collectorId = (cred.guardianId ?? cred.delegateId)!;
      method = 'QR';
    } else if (dto.collectorId && dto.collectorKind) {
      collectorKind = dto.collectorKind;
      collectorId = dto.collectorId;
    }
    if (collectorKind && collectorId) {
      const { name } = await this.loadCollector(auth, collectorKind, collectorId, dto.studentId);
      broughtBy = name;
    }

    const log = await this.db.checkInLog.create({
      data: {
        schoolId: auth.schoolId,
        studentId: dto.studentId,
        broughtBy,
        collectorKind,
        collectorId,
        method,
        recordedById: auth.sub,
        clientRef: dto.clientRef ?? null,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'pickup.checkin', 'Student', dto.studentId, {
      broughtBy: broughtBy ?? undefined,
      method,
    });
    return {
      id: log.id,
      student: `${student.firstName} ${student.lastName}`,
      broughtBy,
      checkedInAt: log.checkedInAt,
    };
  }

  /** The day's arrivals, for the same gate screen that shows the day's releases. */
  async checkIns(auth: AuthUser, date?: string) {
    const from = startOfDay(date ? new Date(date) : new Date());
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    const entries = await this.db.checkInLog.findMany({
      where: { schoolId: auth.schoolId, checkedInAt: { gte: from, lt: to } },
      include: {
        student: {
          select: {
            firstName: true,
            lastName: true,
            admissionNo: true,
            classRoom: { select: { name: true } },
          },
        },
      },
      orderBy: { checkedInAt: 'desc' },
    });
    return entries.map((e) => ({
      id: e.id,
      student: `${e.student.firstName} ${e.student.lastName}`,
      admissionNo: e.student.admissionNo,
      className: e.student.classRoom?.name ?? '—',
      broughtBy: e.broughtBy,
      method: e.method,
      checkedInAt: e.checkedInAt,
    }));
  }

  // ── Car line ───────────────────────────────────────────────────────

  /**
   * The staff queue display: who is outside, in arrival order, with the children they may take.
   * WAITING and CALLED only — DONE and CANCELLED rows exist for the analytics, not the screen.
   */
  async carLineQueue(auth: AuthUser) {
    const from = startOfDay();
    const entries = await this.db.carLineEntry.findMany({
      where: {
        schoolId: auth.schoolId,
        announcedAt: { gte: from },
        status: { in: ['WAITING', 'CALLED'] },
      },
      orderBy: { announcedAt: 'asc' },
      include: {
        guardian: {
          select: {
            firstName: true,
            lastName: true,
            phone: true,
            photoUrl: true,
            students: {
              where: { canPickup: true, custodyFlag: { not: 'BLOCKED' } },
              select: {
                student: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    status: true,
                    classRoom: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    return entries.map((e, i) => ({
      id: e.id,
      position: i + 1,
      status: e.status,
      announcedAt: e.announcedAt,
      calledAt: e.calledAt,
      guardian: {
        name: `${e.guardian.firstName} ${e.guardian.lastName}`,
        phone: e.guardian.phone,
        hasPhoto: !!e.guardian.photoUrl,
      },
      children: e.guardian.students
        .filter((s) => s.student.status === 'ACTIVE')
        .map((s) => ({
          id: s.student.id,
          name: `${s.student.firstName} ${s.student.lastName}`,
          className: s.student.classRoom?.name ?? null,
        })),
    }));
  }

  /** Move an arrival through the queue: call the family forward, or finish/cancel the entry. */
  async setCarLineStatus(auth: AuthUser, id: string, status: 'CALLED' | 'DONE' | 'CANCELLED') {
    const entry = await this.db.carLineEntry.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!entry) throw new NotFoundException('Not in the queue');
    if (entry.status === 'DONE' || entry.status === 'CANCELLED') {
      throw new BadRequestException('That arrival is already finished');
    }
    await this.db.carLineEntry.update({
      where: { id },
      data: {
        status,
        calledAt: status === 'CALLED' ? new Date() : entry.calledAt,
        doneAt: status === 'DONE' || status === 'CANCELLED' ? new Date() : null,
      },
    });
    return { ok: true, status };
  }

  // ── Dismissal-change requests ──────────────────────────────────────

  async listDismissalRequests(auth: AuthUser, status?: string) {
    const requests = await this.db.dismissalRequest.findMany({
      where: {
        schoolId: auth.schoolId,
        ...(status ? { status: status as 'PENDING' | 'APPROVED' | 'DECLINED' } : {}),
      },
      include: {
        student: { select: { firstName: true, lastName: true, admissionNo: true } },
        guardian: { select: { firstName: true, lastName: true, phone: true } },
      },
      orderBy: [{ status: 'asc' }, { forDate: 'desc' }],
      take: 100,
    });
    return requests.map((r) => ({
      id: r.id,
      student: `${r.student.firstName} ${r.student.lastName}`,
      admissionNo: r.student.admissionNo,
      guardian: `${r.guardian.firstName} ${r.guardian.lastName}`,
      guardianPhone: r.guardian.phone,
      forDate: r.forDate,
      details: r.details,
      status: r.status,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt,
    }));
  }

  async decideDismissalRequest(auth: AuthUser, id: string, dto: DismissalDecisionDto) {
    const req = await this.db.dismissalRequest.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: { guardian: { select: { phone: true } }, student: true },
    });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== 'PENDING') throw new BadRequestException('That request is already decided');

    await this.db.dismissalRequest.update({
      where: { id },
      data: {
        status: dto.status,
        decisionNote: dto.decisionNote,
        decidedById: auth.sub,
        decidedAt: new Date(),
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'pickup.dismissal.decide',
      'Student',
      req.studentId,
      {
        status: dto.status,
      },
    );

    const school = await this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } });
    await this.sms.sendToPhones({
      schoolId: auth.schoolId,
      createdById: auth.sub,
      phones: [req.guardian.phone],
      body: `${school.name}: your dismissal request for ${req.student.firstName} was ${dto.status.toLowerCase()}.${dto.decisionNote ? ' ' + dto.decisionNote : ''}`,
      batchId: `DISMISS-${id}`,
    });
    return { ok: true, status: dto.status };
  }

  /**
   * A face for the person at the gate.
   *
   * docs/02 §2.5 asks for "QR + PIN fallback + guardian photo confirmation". The QR proves the
   * card, the PIN proves knowledge; only the photo proves the person holding either is who the
   * card belongs to. A card can be lent.
   */
  async guardianPhoto(auth: AuthUser, guardianId: string) {
    const g = await this.db.guardian.findFirst({
      where: { id: guardianId, schoolId: auth.schoolId },
      select: { photoUrl: true },
    });
    if (!g?.photoUrl) throw new NotFoundException('No photo on file for this person');
    return storage().get(g.photoUrl);
  }

  async setGuardianPhoto(auth: AuthUser, guardianId: string, file: UploadedPhoto) {
    if (!file) throw new BadRequestException('Choose a photo');
    if (!PHOTO_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Photos must be JPEG or PNG');
    }
    const g = await this.db.guardian.findFirst({
      where: { id: guardianId, schoolId: auth.schoolId },
    });
    if (!g) throw new NotFoundException('Person not found');

    const key = objectKey(auth.schoolId, 'guardian-photos', guardianId, file.originalname);
    await storage().put(key, file.buffer, file.mimetype);
    // Replace rather than accumulate: an old face is not history worth keeping, and storing
    // more pictures of people than the gate needs is its own liability.
    if (g.photoUrl)
      await storage()
        .delete(g.photoUrl)
        .catch(() => undefined);
    await this.db.guardian.update({ where: { id: guardianId }, data: { photoUrl: key } });
    await this.db.audit(auth.schoolId, auth.sub, 'pickup.guardian-photo', 'Guardian', guardianId);
    return { ok: true };
  }

  /** Same contract as guardianPhoto, for a delegate — a driver's face matters as much. */
  async delegatePhoto(auth: AuthUser, delegateId: string) {
    const d = await this.db.pickupDelegate.findFirst({
      where: { id: delegateId, schoolId: auth.schoolId },
      select: { photoUrl: true },
    });
    if (!d?.photoUrl) throw new NotFoundException('No photo on file for this person');
    return storage().get(d.photoUrl);
  }

  async setDelegatePhoto(auth: AuthUser, delegateId: string, file: UploadedPhoto) {
    if (!file) throw new BadRequestException('Choose a photo');
    if (!PHOTO_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Photos must be JPEG or PNG');
    }
    const d = await this.db.pickupDelegate.findFirst({
      where: { id: delegateId, schoolId: auth.schoolId },
    });
    if (!d) throw new NotFoundException('Person not found');

    const key = objectKey(auth.schoolId, 'delegate-photos', delegateId, file.originalname);
    await storage().put(key, file.buffer, file.mimetype);
    if (d.photoUrl)
      await storage()
        .delete(d.photoUrl)
        .catch(() => undefined);
    await this.db.pickupDelegate.update({ where: { id: delegateId }, data: { photoUrl: key } });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'pickup.delegate-photo',
      'PickupDelegate',
      delegateId,
    );
    return { ok: true };
  }
}
@Controller('pickup')
@RequireEntitlement('safety.pickup')
export class PickupController {
  constructor(private svc: PickupService) {}

  @Get('authorised/:studentId')
  @RequirePermission('pickup.view')
  authorised(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    return this.svc.authorised(user, studentId);
  }

  @Post('students/:studentId/delegates')
  @RequirePermission('pickup.manage')
  addDelegate(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Body() dto: DelegateDto,
  ) {
    return this.svc.addDelegate(user, studentId, dto);
  }

  @Delete('delegates/:id')
  @RequirePermission('pickup.manage')
  removeDelegate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.removeDelegate(user, id);
  }

  @Post('cards/:kind/:id')
  @RequirePermission('pickup.manage')
  issueCard(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: CollectorKind,
    @Param('id') id: string,
  ) {
    return this.svc.issueCard(user, kind, id);
  }

  @Delete('cards/:kind/:id')
  @RequirePermission('pickup.manage')
  revokeCard(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: CollectorKind,
    @Param('id') id: string,
  ) {
    return this.svc.revokeCard(user, kind, id);
  }

  /**
   * The PIN is passed back in to be printed because it is never stored in the clear — the card
   * can only be produced in the same sitting as issuing it.
   */
  @Post('cards/:kind/:id/pdf')
  @RequirePermission('pickup.manage')
  async cardPdf(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: CollectorKind,
    @Param('id') id: string,
    @Body('pin') pin: string,
  ) {
    const buf = await this.svc.cardPdf(user, kind, id, pin);
    return new StreamableFile(buf, {
      type: 'application/pdf',
      disposition: 'attachment; filename="pickup-card.pdf"',
    });
  }

  @Get('guardians/:id/photo')
  @RequirePermission('pickup.view')
  async guardianPhoto(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const buf = await this.svc.guardianPhoto(user, id);
    return new StreamableFile(buf, { type: 'image/jpeg' });
  }

  @Post('guardians/:id/photo')
  @RequirePermission('pickup.manage')
  @UseInterceptors(FileInterceptor('file'))
  uploadGuardianPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: UploadedPhoto,
  ) {
    return this.svc.setGuardianPhoto(user, id, file);
  }

  @Get('delegates/:id/photo')
  @RequirePermission('pickup.view')
  async delegatePhoto(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const buf = await this.svc.delegatePhoto(user, id);
    return new StreamableFile(buf, { type: 'image/jpeg' });
  }

  @Post('delegates/:id/photo')
  @RequirePermission('pickup.manage')
  @UseInterceptors(FileInterceptor('file'))
  uploadDelegatePhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: UploadedPhoto,
  ) {
    return this.svc.setDelegatePhoto(user, id, file);
  }

  @Post('verify')
  @RequirePermission('pickup.release')
  verify(@CurrentUser() user: AuthUser, @Body() dto: VerifyDto) {
    return this.svc.verify(user, dto);
  }

  @Post('checkin')
  @RequirePermission('pickup.release')
  checkIn(@CurrentUser() user: AuthUser, @Body() dto: CheckInDto) {
    return this.svc.checkIn(user, dto);
  }

  @Get('checkins')
  @RequirePermission('pickup.view')
  checkIns(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    return this.svc.checkIns(user, date);
  }

  @Post('release')
  @RequirePermission('pickup.release')
  release(@CurrentUser() user: AuthUser, @Body() dto: ReleaseDto) {
    return this.svc.release(user, dto);
  }

  @Get('log')
  @RequirePermission('pickup.view')
  log(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    return this.svc.log(user, date);
  }

  @Get('carline')
  @RequirePermission('pickup.view')
  @RequireEntitlement('safety.carline')
  carLine(@CurrentUser() user: AuthUser) {
    return this.svc.carLineQueue(user);
  }

  @Patch('carline/:id')
  @RequirePermission('pickup.release')
  @RequireEntitlement('safety.carline')
  setCarLine(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('status') status: 'CALLED' | 'DONE' | 'CANCELLED',
  ) {
    if (!['CALLED', 'DONE', 'CANCELLED'].includes(status)) {
      throw new BadRequestException('status must be CALLED, DONE or CANCELLED');
    }
    return this.svc.setCarLineStatus(user, id, status);
  }

  @Get('dismissal-requests')
  @RequirePermission('pickup.view')
  dismissalRequests(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.svc.listDismissalRequests(user, status);
  }

  @Patch('dismissal-requests/:id')
  @RequirePermission('pickup.manage')
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DismissalDecisionDto,
  ) {
    return this.svc.decideDismissalRequest(user, id, dto);
  }
}

@Module({
  imports: [SmsModule],
  controllers: [PickupController],
  providers: [PickupService],
  exports: [PickupService],
})
export class PickupModule {}

export { DismissalRequestDto };
