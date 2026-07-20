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
import { heartbeatPayload, sendHeartbeat, type VerifiedWith } from './heartbeat';

/** How often the box re-checks what it is entitled to. */
const REVALIDATE_MS = 60 * 60 * 1000;

/**
 * How often it reports to its supplier, when a URL is configured at all.
 *
 * Daily rather than hourly: the vendor's interest is a pattern over weeks, and a school's server
 * should not be chattering to the internet twenty-four times a day to say nothing has changed.
 */
const HEARTBEAT_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class LicenceService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Licence');
  private status: LicenceStatus = {
    state: 'MISSING',
    tier: 'BASIC',
    extraEntitlements: [],
  };
  private timer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  /** Last attempt, for the licence screen — including on a box with no licence row to write to. */
  private lastHeartbeat: { at: Date; ok: boolean; detail: string } | null = null;

  constructor(private db: PrismaService) {}

  async onModuleInit() {
    await this.refresh();
    // A plain interval, not BullMQ: this is local file and database work, and an offline box with
    // no Redis must still notice its own licence expiring.
    this.timer = setInterval(() => {
      this.refresh().catch((e) => this.log.error(`Licence re-check failed: ${String(e)}`));
    }, REVALIDATE_MS);
    this.timer.unref();

    /*
      Opt-in, and silent when it is off. A box with no LICENCE_HEARTBEAT_URL never contacts
      anything — which is the right default for a product sold partly on not phoning home, and
      the only correct behaviour on a LAN install with no route out.
    */
    if (this.heartbeatUrl()) {
      // Not on boot: a server restarting in a loop would report on every attempt. First one an
      // hour in, then daily.
      this.heartbeatTimer = setInterval(() => {
        void this.heartbeat();
      }, HEARTBEAT_MS);
      this.heartbeatTimer.unref();
      setTimeout(() => void this.heartbeat(), REVALIDATE_MS).unref();
      this.log.log(
        'Licence reporting is on — a daily summary goes to the configured supplier URL.',
      );
    }
  }

  private heartbeatUrl(): string | undefined {
    // `||` rather than `??`: compose sends an unset variable through as the empty string.
    return process.env.LICENCE_HEARTBEAT_URL || undefined;
  }

  private verifiedWith(): VerifiedWith {
    if (process.env.LICENCE_PUBLIC_KEY) return 'vendor';
    return usingDevLicenceKey() ? 'development' : 'none';
  }

  /**
   * Tell the supplier what this box is running. Never throws, never blocks, never gates anything.
   *
   * A failure here is not a problem to escalate — offline is a supported state — so it is logged
   * at debug and recorded for the licence screen, and that is all.
   */
  async heartbeat(): Promise<{ ok: boolean; detail: string; payload: unknown } | null> {
    const url = this.heartbeatUrl();
    if (!url) return null;

    const school = await this.db.system.school.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const students = school
      ? await this.db.system.student.count({ where: { schoolId: school.id, status: 'ACTIVE' } })
      : 0;

    const payload = heartbeatPayload({
      status: this.status,
      students,
      verifiedWith: this.verifiedWith(),
      appVersion: process.env.npm_package_version ?? 'unknown',
    });

    const result = await sendHeartbeat(url, payload);
    this.lastHeartbeat = { at: new Date(), ok: result.ok, detail: result.detail };
    if (result.ok) this.log.debug(`Licence reported: ${result.detail}`);
    else this.log.debug(`Licence report did not land: ${result.detail}`);

    // Best effort: there may be no licence row to write to, and a failed write here must not turn
    // a missed heartbeat into a failed request.
    await this.db.system.licence
      .update({
        where: { id: 'singleton' },
        data: { lastHeartbeatAt: new Date(), lastHeartbeatOk: result.ok },
      })
      .catch(() => undefined);

    // The payload goes back to the caller so the licence screen can show a school exactly what
    // was sent, rather than a description of it.
    return { ...result, payload };
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  /** What is in force right now. Cheap — no signature check, no query. */
  snapshot(): LicenceStatus {
    return this.status;
  }

  /** The entitlement set in force, tier bundle plus anything the licence granted on top. */
  entitlements(): string[] {
    return entitlementsFor(this.status.tier, this.status.extraEntitlements);
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
      extraEntitlements: s.extraEntitlements,
      daysRemaining: s.daysRemaining ?? null,
      reason: s.reason ?? null,
      usingDevKey: usingDevLicenceKey(),
      /**
       * What this box reports, and when it last did.
       *
       * Shown to the school rather than kept to ourselves. A product that sells on keeping a
       * school's data on the school's own server has to be able to say exactly what it sends and
       * when — anything less makes the claim unverifiable, which is the same as untrue.
       */
      reporting: {
        enabled: !!this.heartbeatUrl(),
        lastAt: this.lastHeartbeat?.at.toISOString() ?? null,
        lastOk: this.lastHeartbeat?.ok ?? null,
        lastDetail: this.lastHeartbeat?.detail ?? null,
        /** Exactly the fields that leave this server. Enumerated so the screen can list them. */
        sends: [
          'Licence id and which school it names',
          'Whether the licence is valid, in grace, expired or missing',
          'The package in force, and the one the licence bought',
          'How many students are enrolled, as a single number',
          'Which key the licence was verified against',
          'The Klasio version this server runs',
        ],
      },
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
