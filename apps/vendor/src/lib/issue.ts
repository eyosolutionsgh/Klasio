/**
 * Issuing a licence from the portal.
 *
 * This is the CLI's job done in a browser. `licence:mint` still exists and still works — it is the
 * right tool on a laptop with the key and no network — but a sales person renewing thirty schools
 * should not be typing shell, and every licence minted at a terminal is one nobody recorded.
 *
 * Issuing here does three things the CLI cannot: it writes down what was sold, it supersedes the
 * licence it replaces so the history reads in order, and it makes the signed text retrievable when
 * a school loses the email.
 */
import { signLicence, type LicencePayload, type LicenceTier } from '@eyo/shared';
import { db } from './db';
import { vendorSigningKey } from './vendor-key';

/** Defaults per package, matching the school application's own `STUDENT_CAPS`. */
const DEFAULT_CAP: Record<LicenceTier, number | null> = {
  BASIC: 150,
  MEDIUM: 1000,
  ADVANCED: null,
};

export interface IssueInput {
  clientId: string;
  tier: LicenceTier;
  months: number;
  /** Undefined takes the tier default; null means explicitly uncapped. */
  studentCap?: number | null;
  extraEntitlements?: string[];
  graceDays?: number;
  issuedById?: string;
}

/**
 * Human-readable, unique, and safe to read down a phone line.
 *
 * Carries the year and the client's slug because the first thing support does is ask a school to
 * read out its licence id, and `lic_2026_kwahu-ridge-academy_03` tells you who and roughly when
 * before you have looked anything up.
 */
function nextLicenceId(slug: string, sequence: number, now: Date): string {
  return `lic_${now.getUTCFullYear()}_${slug}_${String(sequence).padStart(2, '0')}`;
}

export async function issueLicence(input: IssueInput) {
  const client = await db.client.findUnique({
    where: { id: input.clientId },
    include: { licences: { orderBy: { createdAt: 'desc' } } },
  });
  if (!client) throw new Error('No such client');

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + input.months);

  const payload: LicencePayload = {
    v: 1,
    licenceId: nextLicenceId(client.slug, client.licences.length + 1, now),
    schoolName: client.name,
    schoolSlug: client.slug,
    tier: input.tier,
    studentCap: input.studentCap === undefined ? DEFAULT_CAP[input.tier] : input.studentCap,
    extraEntitlements: input.extraEntitlements ?? [],
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    graceDays: input.graceDays ?? 30,
  };

  // Signed before anything is written: a licence that cannot be produced must not leave a row
  // claiming it was.
  const signed = signLicence(payload, vendorSigningKey());

  const created = await db.licence.create({
    data: {
      clientId: client.id,
      licenceId: payload.licenceId,
      tier: payload.tier,
      studentCap: payload.studentCap,
      extraEntitlements: payload.extraEntitlements,
      issuedAt: now,
      expiresAt,
      graceDays: payload.graceDays,
      signed,
      issuedById: input.issuedById,
    },
  });

  /*
    Everything else for this client is now history.

    Marked rather than deleted: a school may still be running the previous licence for days, and a
    support call about it should find the row rather than a gap. The school's own server decides
    what is in force — it holds whichever file it was given — so this is bookkeeping, not control.
  */
  await db.licence.updateMany({
    where: { clientId: client.id, id: { not: created.id }, supersededAt: null },
    data: { supersededAt: now },
  });

  return { licence: created, payload, signed };
}

export { assessClient, SILENT_AFTER_DAYS } from './health';
export type { ClientHealth, ClientRow } from './health';
