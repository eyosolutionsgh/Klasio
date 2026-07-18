/**
 * Entitlement engine (docs/03 §3.5, docs/04 §4.3).
 * Feature code checks entitlements — NEVER tier names. Tiers are bundles of entitlements;
 * on standalone installs the same entitlement set comes from a vendor-signed license file.
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
    'sis.admissions',
    'sis.idcards',
    'fees.discounts',
    'fees.installments',
    'fees.online',
    'fees.reconciliation',
    'fees.reminders',
    'safety.pickup',
    'comms.whatsapp.templates',
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

/** Remaining enrolment headroom; Infinity when the package is uncapped. */
export function enrolmentHeadroom(tier: Tier, currentCount: number): number {
  const cap = studentCapFor(tier);
  if (cap === null) return Infinity;
  return Math.max(0, cap - currentCount);
}
