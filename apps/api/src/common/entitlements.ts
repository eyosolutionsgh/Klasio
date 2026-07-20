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
/**
 * What each code is called on screen.
 *
 * A school's licence screen used to list raw codes: `ai.remarks` tells a head teacher nothing, and
 * "what am I paying for" is exactly the question that screen exists to answer.
 *
 * A deliberate copy of the labels in `packages/shared/src/entitlements-catalogue.ts`, which is what
 * the vendor portal sells from. The API cannot import that package at runtime — a Nest build
 * resolves it to a TypeScript entrypoint and crashes — so the two are held in step by
 * `licence/entitlements-parity.spec.ts` instead, which fails on any code or wording that drifts.
 */
export const ENTITLEMENT_LABELS: Record<string, string> = {
  'sis.core': 'Student records',
  'attendance.core': 'Daily register',
  'assessment.core': 'Marks and assessment',
  'reports.terminal': 'Terminal reports',
  'fees.manual': 'Fees, recorded by hand',
  'portal.readonly': 'Guardian and student portals',
  'comms.announcements': 'Notice board',
  'comms.sms': 'Bulk SMS',
  'platform.export': 'Data export',

  'attendance.dashboards': 'Attendance trends',
  'sis.admissions': 'Admissions',
  'sis.idcards': 'Student ID cards',
  'fees.discounts': 'Concessions and discounts',
  'fees.installments': 'Payment plans',
  'fees.online': 'Online payments',
  'fees.reconciliation': 'Bank reconciliation',
  'fees.reminders': 'Automatic fee reminders',
  'safety.pickup': 'Dismissal and pickup',
  'comms.absence-alerts': 'Same-morning absence texts',
  'comms.results-push': 'Results notifications',
  'comms.whatsapp.templates': 'WhatsApp replies',
  'comms.social': 'Social media publishing',
  'resources.documents': 'Shared class resources',
  'timetable.core': 'Timetable',
  'platform.ges-returns': 'GES termly returns',
  'branding.documents': 'Branded documents',

  'ai.remarks': 'AI report remarks',
  'ai.script-capture': 'AI script capture',
  'ai.chatbot': 'AI assistant',
  'ai.default-risk': 'Fee default prediction',
  'ai.insights': 'AI insights',
  'safety.carline': 'Car line',
  'safety.transport': 'School transport',
  'comms.whatsapp.chatbot': 'WhatsApp assistant',
  'comms.ussd': 'USSD access',
  'hr.payroll': 'Staff payroll',
  'exams.cbt': 'Computer-based exams',
  'platform.api': 'API access',
  'platform.multicampus': 'Multi-campus',
  'branding.apps': 'Branded mobile apps',
};

/**
 * A code's label, falling back to the code itself.
 *
 * The fallback is load-bearing rather than defensive: a vendor can sell a code this build has
 * never heard of, and showing `some.new.thing` is honest where showing nothing would hide a
 * feature the school has paid for.
 */
export function entitlementLabel(code: string): string {
  return ENTITLEMENT_LABELS[code] ?? code;
}

export function entitlementsFor(tier: Tier, extra: readonly string[] = []): string[] {
  return [...new Set([...entitlementsForTier(tier), ...extra])];
}

export function hasEntitlement(tier: Tier, code: string): boolean {
  return entitlementsForTier(tier).includes(code);
}
