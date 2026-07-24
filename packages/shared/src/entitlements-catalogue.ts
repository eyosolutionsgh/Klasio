/**
 * Every entitlement a licence can name, with a label a salesperson can read.
 *
 * The vendor portal offers these as a list to tick. The codes themselves are the school
 * application's, and `apps/api/src/common/entitlements-parity.spec.ts` holds the two in step — if
 * this drifts, the portal offers a code the product ignores, and a school pays for a feature that
 * never appears.
 *
 * `tier` records which package a code normally arrives with. It is descriptive, not a rule: the
 * whole point of `extraEntitlements` is selling one Advanced feature to a Medium school, so the
 * portal shows the package a code belongs to and lets staff tick it anyway.
 */
import type { LicenceTier } from './licence-format';

export interface EntitlementSpec {
  code: string;
  label: string;
  tier: LicenceTier;
}

export const ENTITLEMENT_CATALOGUE: EntitlementSpec[] = [
  { code: 'sis.core', label: 'Student records', tier: 'BASIC' },
  { code: 'attendance.core', label: 'Daily register', tier: 'BASIC' },
  { code: 'assessment.core', label: 'Marks and assessment', tier: 'BASIC' },
  { code: 'reports.terminal', label: 'Terminal reports', tier: 'BASIC' },
  { code: 'fees.manual', label: 'Fees, recorded by hand', tier: 'BASIC' },
  { code: 'portal.readonly', label: 'Guardian and student portals', tier: 'BASIC' },
  { code: 'comms.announcements', label: 'Notice board', tier: 'BASIC' },
  { code: 'comms.sms', label: 'Bulk SMS', tier: 'BASIC' },
  { code: 'platform.export', label: 'Data export', tier: 'BASIC' },

  { code: 'attendance.dashboards', label: 'Attendance trends', tier: 'MEDIUM' },
  { code: 'sis.admissions', label: 'Admissions', tier: 'MEDIUM' },
  { code: 'sis.idcards', label: 'Student ID cards', tier: 'MEDIUM' },
  { code: 'fees.discounts', label: 'Concessions and discounts', tier: 'MEDIUM' },
  { code: 'fees.installments', label: 'Payment plans', tier: 'MEDIUM' },
  { code: 'fees.online', label: 'Online payments', tier: 'MEDIUM' },
  { code: 'fees.reconciliation', label: 'Bank reconciliation', tier: 'MEDIUM' },
  { code: 'fees.reminders', label: 'Automatic fee reminders', tier: 'MEDIUM' },
  { code: 'safety.pickup', label: 'Dismissal and pickup', tier: 'MEDIUM' },
  { code: 'comms.absence-alerts', label: 'Same-morning absence texts', tier: 'MEDIUM' },
  { code: 'comms.results-push', label: 'Results notifications', tier: 'MEDIUM' },
  { code: 'comms.whatsapp.templates', label: 'WhatsApp replies', tier: 'MEDIUM' },
  { code: 'comms.social', label: 'Social media publishing', tier: 'MEDIUM' },
  { code: 'resources.documents', label: 'Shared class resources', tier: 'MEDIUM' },
  { code: 'timetable.core', label: 'Timetable', tier: 'MEDIUM' },
  { code: 'platform.ges-returns', label: 'GES termly returns', tier: 'MEDIUM' },
  { code: 'branding.documents', label: 'Branded documents', tier: 'MEDIUM' },

  { code: 'ai.remarks', label: 'AI report remarks', tier: 'ADVANCED' },
  { code: 'ai.script-capture', label: 'AI script capture', tier: 'ADVANCED' },
  { code: 'ai.chatbot', label: 'AI assistant', tier: 'ADVANCED' },
  { code: 'ai.default-risk', label: 'Fee default prediction', tier: 'ADVANCED' },
  { code: 'ai.insights', label: 'AI insights', tier: 'ADVANCED' },
  { code: 'safety.carline', label: 'Car line', tier: 'ADVANCED' },
  { code: 'safety.emergency', label: 'Emergency & lockdown alerts', tier: 'ADVANCED' },
  { code: 'safety.transport', label: 'School transport', tier: 'ADVANCED' },
  { code: 'housing.boarding', label: 'Boarding & hostels', tier: 'ADVANCED' },
  { code: 'canteen.wallet', label: 'Canteen wallet', tier: 'ADVANCED' },
  { code: 'lms.core', label: 'Lessons & assignments', tier: 'ADVANCED' },
  { code: 'comms.whatsapp.chatbot', label: 'WhatsApp assistant', tier: 'ADVANCED' },
  { code: 'comms.ussd', label: 'USSD access', tier: 'ADVANCED' },
  { code: 'resources.media', label: 'Video and audio resources', tier: 'ADVANCED' },
  { code: 'hr.payroll', label: 'Staff payroll', tier: 'ADVANCED' },
  { code: 'hr.attendance', label: 'Staff attendance & leave', tier: 'ADVANCED' },
  { code: 'exams.cbt', label: 'Computer-based exams', tier: 'ADVANCED' },
  { code: 'exams.analytics', label: 'BECE & WASSCE outlook', tier: 'ADVANCED' },
  { code: 'platform.api', label: 'API access', tier: 'ADVANCED' },
  { code: 'platform.multicampus', label: 'Multi-campus', tier: 'ADVANCED' },
  { code: 'branding.apps', label: 'Branded mobile apps', tier: 'ADVANCED' },
];

/** Codes a package already includes, so the portal can show what a tick would actually add. */
export function includedIn(tier: LicenceTier): Set<string> {
  const rank: Record<LicenceTier, number> = { BASIC: 0, MEDIUM: 1, ADVANCED: 2 };
  return new Set(
    ENTITLEMENT_CATALOGUE.filter((e) => rank[e.tier] <= rank[tier]).map((e) => e.code),
  );
}
