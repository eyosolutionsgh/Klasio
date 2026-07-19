/**
 * What licence is in force, and installing a new one.
 *
 * ## Why this is not in licence.module.ts, against the one-file-per-module convention
 *
 * The auth guard has to ask this service whether a feature is licensed. `common/auth.ts` therefore
 * imports it — and `licence.module.ts` imports `common/auth.ts` for `@RequirePermission` and
 * `@CurrentUser`. Keeping the service there made a runtime import cycle whose only symptom was
 * `RequirePermission is not a function` at boot, thrown from a line that is obviously fine.
 *
 * So the service lives here and imports nothing from `common/auth` but a type, which TypeScript
 * erases. The controller and the @Module stay next door where the convention expects them.
 *
 * ## Why School.tier survives
 *
 * It would have been tidier to delete the column and have every caller ask this service. It would
 * also have meant touching ~30 `@RequireEntitlement` sites, the JWT claim and the web mirrors — a
 * large diff through the most security-sensitive code in the product, to change where a value
 * comes from rather than what it means. Instead this service is the only writer of `School.tier`,
 * and everything downstream is untouched. CLAUDE.md rule 3 still holds: code checks entitlement
 * codes, never tier names.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { readFile } from 'fs/promises';
import type { Tier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/auth';
import { entitlementsFor } from '../common/entitlements';
import {
  evaluateLicence,
  LicenceError,
  verifyLicence,
  type LicencePayload,
  type LicenceStatus,
} from './licence';
import { InsecureLicenceKeyError, licencePublicKey, usingDevLicenceKey } from './licence-key';

/** How often the box re-checks what it is entitled to. */
const REVALIDATE_MS = 60 * 60 * 1000;

@Injectable()
export class LicenceService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Licence');
  private status: LicenceStatus = {
    state: 'MISSING',
    tier: 'BASIC',
    studentCap: 150,
    extraEntitlements: [],
  };
  private timer?: NodeJS.Timeout;

  constructor(private db: PrismaService) {}

  async onModuleInit() {
    await this.refresh();
    // A plain interval, not BullMQ: this is local file and database work, and an offline box with
    // no Redis must still notice its own licence expiring.
    this.timer = setInterval(() => {
      this.refresh().catch((e) => this.log.error(`Licence re-check failed: ${String(e)}`));
    }, REVALIDATE_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** What is in force right now. Cheap — no signature check, no query. */
  snapshot(): LicenceStatus {
    return this.status;
  }

  /** The entitlement set in force, tier bundle plus anything the licence granted on top. */
  entitlements(): string[] {
    return entitlementsFor(this.status.tier, this.status.extraEntitlements);
  }

  studentCap(): number | null {
    return this.status.studentCap;
  }

  /**
   * Resolve the licence and apply it.
   *
   * Order matters: the database row wins, because that is what the settings screen writes and it
   * is the only source a school can update without shell access on their own server. A file or
   * env var is how a licence gets in the first time, or onto an air-gapped box.
   */
  async refresh(): Promise<LicenceStatus> {
    const raw = await this.resolveRaw();
    const school = await this.db.system.school.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true, slug: true, tier: true },
    });

    this.status = this.evaluate(raw, school?.slug);
    this.report();

    // Nothing to write tier onto before the setup wizard has run.
    if (school && school.tier !== this.status.tier) {
      await this.db.system.school.update({
        where: { id: school.id },
        data: { tier: this.status.tier },
      });
      this.log.log(
        `Tier moved ${school.tier} → ${this.status.tier} (licence ${this.status.state})`,
      );
    }
    return this.status;
  }

  /**
   * Verify and evaluate without touching anything. Both the boot path and the install path go
   * through here so a licence can never be stored that would not have been accepted at boot.
   */
  private evaluate(raw: string | null, schoolSlug?: string): LicenceStatus {
    if (!raw) return evaluateLicence(null);
    try {
      const payload = verifyLicence(raw, licencePublicKey());
      return evaluateLicence(payload, { schoolSlug });
    } catch (e) {
      // An unreadable licence is not a reason to refuse to boot. A school that lost a text file
      // must not also lose this morning's register — they drop to BASIC and are told why.
      const reason =
        e instanceof LicenceError || e instanceof InsecureLicenceKeyError ? e.message : String(e);
      return evaluateLicence(null, { reason });
    }
  }

  private async resolveRaw(): Promise<string | null> {
    const row = await this.db.system.licence.findUnique({ where: { id: 'singleton' } });
    if (row) return row.raw;

    const path = process.env.LICENCE_FILE;
    if (path) {
      try {
        return (await readFile(path, 'utf8')).trim();
      } catch (e) {
        this.log.warn(`LICENCE_FILE is set to ${path} but could not be read: ${String(e)}`);
      }
    }
    return process.env.LICENCE?.trim() || null;
  }

  private report() {
    const s = this.status;
    if (s.state === 'VALID') {
      this.log.log(
        `Licence ${s.payload?.licenceId} valid — ${s.tier}, ${s.daysRemaining} day(s) left`,
      );
    } else if (s.state === 'GRACE') {
      this.log.warn(`Licence expired — ${s.reason}. Still on ${s.tier} for now.`);
    } else {
      this.log.error(`No licence in force (${s.state}): ${s.reason}. Running on BASIC.`);
    }
    if (usingDevLicenceKey()) {
      this.log.warn(
        'LICENCE_PUBLIC_KEY is not set — using the development key. Not for production.',
      );
    }
  }

  /** Install or replace the licence. Verified before it is stored, never after. */
  async install(licenceRaw: string, auth: AuthUser): Promise<LicenceStatus> {
    const school = await this.db.system.school.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true, slug: true },
    });

    let payload: LicencePayload;
    try {
      payload = verifyLicence(licenceRaw, licencePublicKey());
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Licence could not be read');
    }

    // Bind-check before storing. Storing a licence for another school then reporting INVALID
    // would leave the school looking at someone else's name in their own settings screen.
    const candidate = evaluateLicence(payload, { schoolSlug: school?.slug });
    if (candidate.state === 'INVALID') throw new BadRequestException(candidate.reason);

    const data = {
      raw: licenceRaw.trim(),
      licenceId: payload.licenceId,
      schoolSlug: payload.schoolSlug,
      tier: payload.tier as Tier,
      studentCap: payload.studentCap,
      expiresAt: new Date(payload.expiresAt),
      issuedAt: new Date(payload.issuedAt),
      installedById: auth.sub,
    };
    await this.db.system.licence.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...data },
      update: data,
    });

    await this.db.audit(auth.schoolId, auth.sub, 'licence.install', 'Licence', payload.licenceId, {
      tier: payload.tier,
      expiresAt: payload.expiresAt,
    });
    return this.refresh();
  }

  /** What the settings screen shows. Never returns the raw licence — it is not a secret, but
   *  echoing it back adds nothing and invites treating it as one. */
  view() {
    const s = this.status;
    return {
      state: s.state,
      tier: s.tier,
      studentCap: s.studentCap,
      extraEntitlements: s.extraEntitlements,
      daysRemaining: s.daysRemaining ?? null,
      reason: s.reason ?? null,
      usingDevKey: usingDevLicenceKey(),
      licence: s.payload
        ? {
            licenceId: s.payload.licenceId,
            schoolName: s.payload.schoolName,
            schoolSlug: s.payload.schoolSlug,
            issuedAt: s.payload.issuedAt,
            expiresAt: s.payload.expiresAt,
            graceDays: s.payload.graceDays,
          }
        : null,
    };
  }
}
