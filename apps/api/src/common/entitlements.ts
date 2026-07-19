/**
 * Entitlement engine (docs/03 §3.5, docs/04 §4.3).
 *
 * Feature code checks entitlements — NEVER tier names. Tiers are bundles of entitlements, and the
 * bundle in force comes from the vendor-signed licence file this box was installed with; see
 * `licence/licence.module.ts`, which is the only thing that writes `School.tier`.
 */
import type { Tier } from '@prisma/client';

export const ENTITLEMENTS = {
  BASIC: [
    'sis.core',
    'attendance.core',
    'assessment.core',
    'reports.terminal',
    'fees.manual',
    'portal.readonly',
    'comms.announcements',
    'comms.sms',
    'platform.export',
  ],
  MEDIUM: [
    'attendance.dashboards',
    'sis.admissions',
    'sis.idcards',
    'fees.discounts',
    'fees.installments',
    'fees.online',
    'fees.reconciliation',
    'fees.reminders',
    'safety.pickup',
    // Automatic, system-raised messages: the same-morning absence text and the results
    // notification. Distinct from 'comms.sms' (Basic), which is a human choosing to send.
    'comms.absence-alerts',
    'comms.results-push',
    'comms.whatsapp.templates',
    // Publishing to the school's own Facebook/Instagram/X/TikTok. A marketing capability rather
    // than a duty of care, so Basic schools keep the portal and SMS and do without this.
    'comms.social',
    'resources.documents',
    'timetable.core',
    'platform.ges-returns',
    'branding.documents',
  ],
  ADVANCED: [
    'ai.remarks',
    'ai.script-capture',
    'ai.chatbot',
    'ai.default-risk',
    'ai.insights',
    'safety.carline',
    'safety.transport',
    'comms.whatsapp.chatbot',
    'comms.ussd',
    'hr.payroll',
    'exams.cbt',
    'platform.api',
    'platform.multicampus',
    'branding.apps',
  ],
} as const;

export type Entitlement =
  | (typeof ENTITLEMENTS.BASIC)[number]
  | (typeof ENTITLEMENTS.MEDIUM)[number]
  | (typeof ENTITLEMENTS.ADVANCED)[number];

export function entitlementsForTier(tier: Tier): string[] {
  const base: string[] = [...ENTITLEMENTS.BASIC];
  if (tier === 'MEDIUM' || tier === 'ADVANCED') base.push(...ENTITLEMENTS.MEDIUM);
  if (tier === 'ADVANCED') base.push(...ENTITLEMENTS.ADVANCED);
  return base;
}

/**
 * The tier bundle plus any individual codes the licence granted on top.
 *
 * `extraEntitlements` exists so the vendor can sell one Advanced feature to a Medium school —
 * a school that wants AI remarks and nothing else in Advanced — by reissuing a licence, rather
 * than by cutting a release with a new tier in it. Deduped, because a code that is already in the
 * bundle being listed again should be a no-op, not a double entry in the /me payload.
 */
export function entitlementsFor(tier: Tier, extra: readonly string[] = []): string[] {
  return [...new Set([...entitlementsForTier(tier), ...extra])];
}

export function hasEntitlement(tier: Tier, code: string): boolean {
  return entitlementsForTier(tier).includes(code);
}

/**
 * Enrolment caps per package (docs/02 §2.1). `null` = unlimited.
 *
 * Per docs/03 §3.5 an over-cap school is blocked from *new enrolments only* — never from
 * reading, exporting or working with the students it already has. We do not hold data hostage.
 */
export const STUDENT_CAPS: Record<Tier, number | null> = {
  BASIC: 150,
  MEDIUM: 1000,
  ADVANCED: null,
};

export function studentCapFor(tier: Tier): number | null {
  return STUDENT_CAPS[tier];
}

/**
 * Remaining headroom against an explicit cap; Infinity when uncapped.
 *
 * Takes the cap rather than the tier because the cap in force comes from the licence, which may
 * raise or lower it for one school without inventing a tier to hold the difference.
 */
export function headroomFor(cap: number | null, currentCount: number): number {
  if (cap === null) return Infinity;
  return Math.max(0, cap - currentCount);
}

/** Remaining enrolment headroom at a tier's default cap; Infinity when the package is uncapped. */
export function enrolmentHeadroom(tier: Tier, currentCount: number): number {
  return headroomFor(studentCapFor(tier), currentCount);
}
