/**
 * What a person is allowed to do.
 *
 * Roles alone were too coarse. A school has a head of department who marks their own subject but
 * has no business recording a payment, a cashier who takes money but must not change the fee
 * structure, and a secretary who enrols children but must not publish results. Six enum values
 * could not express that, so permission is now the unit of authority and a role is a named bundle
 * of permissions the school can edit.
 *
 * Two rules the design turns on, both from ordinary access-control practice:
 *
 * - **Least privilege.** Presets grant the minimum a job needs. It is easier for a head to add a
 *   permission than to discover months later that everyone could see everything.
 * - **Separation of duties.** Recording money, changing what money is owed, and reconciling what
 *   arrived are three different permissions on purpose. One person holding all three can move
 *   money and hide it; that is the fraud these systems exist to make awkward.
 *
 * Codes are defined here in code, not in the database. They are referenced by feature code, so a
 * school inventing a permission would be inventing something nothing checks.
 */

export interface PermissionDef {
  code: string;
  /** Shown in the role editor. Written for a head teacher, not an engineer. */
  label: string;
  group: PermissionGroup;
  /** Why this one is dangerous, where that is not obvious. */
  caution?: string;
}

export type PermissionGroup =
  'Students' | 'Attendance' | 'Academics' | 'Money' | 'Safety' | 'Communication' | 'Administration';

export const PERMISSIONS = [
  // ── Students ──────────────────────────────────────────────────────
  { code: 'students.view', label: 'See student records', group: 'Students' },
  { code: 'students.create', label: 'Enrol a new student', group: 'Students' },
  { code: 'students.edit', label: 'Edit student records', group: 'Students' },
  {
    code: 'students.lifecycle',
    label: 'Promote, transfer and withdraw students',
    group: 'Students',
    caution: 'Moves children between classes and off the active roll.',
  },
  { code: 'students.guardians', label: 'Manage guardians and contacts', group: 'Students' },
  { code: 'students.medical', label: 'See and record medical notes', group: 'Students' },
  { code: 'students.documents', label: 'Upload and remove student documents', group: 'Students' },
  {
    code: 'students.export',
    label: 'Export student data',
    group: 'Students',
    caution: 'Takes personal data about children out of the system.',
  },
  { code: 'students.import', label: 'Bulk import students', group: 'Students' },
  { code: 'admissions.view', label: 'See applicants', group: 'Students' },
  { code: 'admissions.manage', label: 'Move applicants and admit them', group: 'Students' },

  // ── Attendance ────────────────────────────────────────────────────
  { code: 'attendance.view', label: 'See the register', group: 'Attendance' },
  { code: 'attendance.mark', label: 'Mark the register', group: 'Attendance' },
  { code: 'attendance.dashboards', label: 'See attendance trends and flags', group: 'Attendance' },

  // ── Academics ─────────────────────────────────────────────────────
  { code: 'marks.view', label: 'See marks', group: 'Academics' },
  {
    code: 'marks.enter',
    label: 'Enter marks',
    group: 'Academics',
    caution: 'Teachers can only enter marks for classes and subjects they teach.',
  },
  { code: 'assessment.configure', label: 'Set up assessments and grading', group: 'Academics' },
  { code: 'reports.view', label: 'See report cards', group: 'Academics' },
  { code: 'reports.generate', label: 'Generate report cards', group: 'Academics' },
  { code: 'reports.remark.teacher', label: "Write the class teacher's remark", group: 'Academics' },
  { code: 'reports.remark.head', label: "Write the head teacher's remark", group: 'Academics' },
  {
    code: 'reports.publish',
    label: 'Publish results to families',
    group: 'Academics',
    caution: 'Releases marks to parents and cannot be quietly undone.',
  },
  { code: 'timetable.view', label: 'See the timetable', group: 'Academics' },
  { code: 'timetable.manage', label: 'Build the timetable', group: 'Academics' },
  { code: 'resources.view', label: 'See learning resources', group: 'Academics' },
  { code: 'resources.manage', label: 'Upload and publish learning resources', group: 'Academics' },

  // ── Money ─────────────────────────────────────────────────────────
  { code: 'fees.view', label: 'See fee balances and the ledger', group: 'Money' },
  {
    code: 'fees.record_payment',
    label: 'Record a payment',
    group: 'Money',
    caution: 'Takes money in. Keep separate from setting what is owed.',
  },
  {
    code: 'fees.structure',
    label: 'Set fees and what each student is charged',
    group: 'Money',
    caution: 'Decides what families owe. Keep separate from recording payments.',
  },
  {
    code: 'fees.invoice',
    label: 'Raise invoices for a term',
    group: 'Money',
  },
  {
    code: 'fees.concessions',
    label: 'Grant discounts, waivers and scholarships',
    group: 'Money',
    caution: 'Reduces what a family owes.',
  },
  {
    code: 'fees.reconcile',
    label: 'Reconcile gateway settlements',
    group: 'Money',
    caution:
      'Confirms which payments really arrived. Best held by someone who cannot record payments.',
  },
  { code: 'fees.deposits', label: 'Confirm bank deposits', group: 'Money' },
  { code: 'fees.gateways', label: 'Connect payment gateways', group: 'Money' },
  { code: 'fees.export', label: 'Export financial data', group: 'Money' },
  {
    code: 'billing.manage',
    label: "Change the school's EYO package",
    group: 'Money',
    caution: 'Commits the school to a bill.',
  },

  // ── Safety ────────────────────────────────────────────────────────
  { code: 'pickup.view', label: 'See who may collect a child', group: 'Safety' },
  {
    code: 'pickup.release',
    label: 'Release a child at dismissal',
    group: 'Safety',
    caution: 'The gate decision itself.',
  },
  { code: 'pickup.manage', label: 'Manage collectors and pickup cards', group: 'Safety' },

  // ── Communication ─────────────────────────────────────────────────
  { code: 'comms.announce', label: 'Post announcements', group: 'Communication' },
  {
    code: 'comms.sms',
    label: 'Send bulk SMS',
    group: 'Communication',
    caution: "Spends the school's SMS credits.",
  },
  { code: 'comms.whatsapp', label: 'Reply to families on WhatsApp', group: 'Communication' },
  { code: 'calendar.manage', label: 'Manage the school calendar', group: 'Communication' },

  // ── Administration ────────────────────────────────────────────────
  {
    code: 'school.settings',
    label: 'Change school details and structure',
    group: 'Administration',
  },
  { code: 'school.branding', label: 'Change the logo and colours', group: 'Administration' },
  {
    code: 'records.configure',
    label: 'Set up custom fields and checklists',
    group: 'Administration',
  },
  {
    code: 'users.view',
    label: 'See staff accounts',
    group: 'Administration',
  },
  {
    code: 'users.manage',
    label: 'Create staff accounts and assign roles',
    group: 'Administration',
    caution: 'Anyone with this can grant access to everything they themselves hold.',
  },
  {
    code: 'roles.manage',
    label: 'Create and edit roles',
    group: 'Administration',
    caution: 'Changes what every holder of a role can do.',
  },
  { code: 'audit.view', label: 'See the audit log', group: 'Administration' },
  { code: 'returns.view', label: 'Produce GES and NaSIA returns', group: 'Administration' },
] as const satisfies readonly PermissionDef[];

export type Permission = (typeof PERMISSIONS)[number]['code'];

export const ALL_PERMISSIONS: string[] = PERMISSIONS.map((p) => p.code);
const KNOWN = new Set<string>(ALL_PERMISSIONS);

export function isPermission(code: string): boolean {
  return KNOWN.has(code);
}

/** Drops anything the code no longer defines — a stored role can outlive a renamed permission. */
export function sanitizePermissions(codes: string[]): string[] {
  return [...new Set(codes.filter(isPermission))].sort();
}

/**
 * Preset roles, grounded in how Ghanaian private schools actually staff.
 *
 * A school gets these on day one and can edit any of them, or build its own. `key` is stable and
 * used to seed; `name` is what the school sees and may rename.
 *
 * The proprietor is deliberately absent from this list — see OWNER_HOLDS_EVERYTHING below.
 */
export interface RolePreset {
  key: string;
  name: string;
  description: string;
  permissions: string[];
}

const TEACHING_CORE = [
  'students.view',
  'attendance.view',
  'attendance.mark',
  'marks.view',
  'marks.enter',
  'reports.view',
  'timetable.view',
  'resources.view',
];

export const ROLE_PRESETS: RolePreset[] = [
  {
    key: 'HEAD',
    name: 'Head Teacher',
    description: 'Runs the school day to day. Sees the money but does not handle it.',
    permissions: [
      ...TEACHING_CORE,
      'students.create',
      'students.edit',
      'students.lifecycle',
      'students.guardians',
      'students.medical',
      'students.documents',
      'students.export',
      'admissions.view',
      'admissions.manage',
      'attendance.dashboards',
      'assessment.configure',
      'reports.generate',
      'reports.remark.head',
      'reports.publish',
      'timetable.manage',
      'resources.manage',
      // Sees balances and defaulters, but cannot take money, set fees or grant discounts.
      'fees.view',
      'pickup.view',
      'pickup.manage',
      'comms.announce',
      'comms.sms',
      'comms.whatsapp',
      'calendar.manage',
      'school.settings',
      'records.configure',
      'users.view',
      'audit.view',
      'returns.view',
    ],
  },
  {
    key: 'ASSISTANT_HEAD',
    name: 'Assistant Head',
    description: 'Deputises on academics and discipline. No access to money.',
    permissions: [
      ...TEACHING_CORE,
      'students.edit',
      'students.guardians',
      'attendance.dashboards',
      'assessment.configure',
      'reports.generate',
      'reports.remark.head',
      'timetable.manage',
      'resources.manage',
      'pickup.view',
      'comms.announce',
      'calendar.manage',
    ],
  },
  {
    key: 'HEAD_OF_DEPARTMENT',
    name: 'Head of Department',
    description: 'Leads a subject area: marks, schemes of work, and their department’s results.',
    permissions: [
      ...TEACHING_CORE,
      'assessment.configure',
      'reports.generate',
      'reports.remark.teacher',
      'resources.manage',
      'timetable.view',
    ],
  },
  {
    key: 'CLASS_TEACHER',
    name: 'Class Teacher',
    description: 'Owns a class: register, marks, and the class teacher’s remark.',
    permissions: [
      ...TEACHING_CORE,
      'students.medical',
      'reports.remark.teacher',
      'reports.generate',
      'pickup.view',
    ],
  },
  {
    key: 'SUBJECT_TEACHER',
    name: 'Subject Teacher',
    description: 'Teaches a subject across classes. Marks only, no remarks.',
    permissions: TEACHING_CORE,
  },
  {
    key: 'EXAMS_OFFICER',
    name: 'Exams Officer',
    description: 'Runs assessment and the terminal reports, without teaching.',
    permissions: [
      'students.view',
      'marks.view',
      'assessment.configure',
      'reports.view',
      'reports.generate',
      'reports.publish',
      'returns.view',
    ],
  },
  {
    key: 'BURSAR',
    name: 'Bursar',
    description: 'Runs the school’s finances: fees, invoicing, reconciliation.',
    permissions: [
      'students.view',
      'fees.view',
      'fees.record_payment',
      'fees.structure',
      'fees.invoice',
      'fees.concessions',
      'fees.reconcile',
      'fees.deposits',
      'fees.gateways',
      'fees.export',
      'comms.sms',
      'audit.view',
    ],
  },
  {
    key: 'ACCOUNTS_CLERK',
    name: 'Accounts Clerk',
    description:
      'Takes payments at the counter. Cannot change what is owed, or reconcile what arrived.',
    // The separation of duties this whole model exists for: money in, but no authority over
    // what is owed and no authority to confirm what settled.
    permissions: ['students.view', 'fees.view', 'fees.record_payment', 'fees.deposits'],
  },
  {
    key: 'REGISTRAR',
    name: 'Registrar',
    description: 'Admissions and enrolment.',
    permissions: [
      'students.view',
      'students.create',
      'students.edit',
      'students.guardians',
      'students.documents',
      'students.import',
      'admissions.view',
      'admissions.manage',
      'records.configure',
    ],
  },
  {
    key: 'FRONT_DESK',
    name: 'Front Desk',
    description: 'Reception: enquiries, contacts, and the dismissal gate.',
    permissions: [
      'students.view',
      'students.guardians',
      'attendance.view',
      'admissions.view',
      'pickup.view',
      'pickup.release',
      'pickup.manage',
      'comms.announce',
      'calendar.manage',
    ],
  },
  {
    key: 'SCHOOL_NURSE',
    name: 'School Nurse',
    description: 'Sick bay. Sees who is in school and their medical notes, nothing else.',
    permissions: ['students.view', 'students.medical', 'attendance.view', 'pickup.view'],
  },
  {
    key: 'LIBRARIAN',
    name: 'Librarian',
    description: 'Learning resources.',
    permissions: ['students.view', 'resources.view', 'resources.manage'],
  },
  {
    key: 'IT_ADMIN',
    name: 'IT Administrator',
    description:
      'Manages accounts and access. Deliberately holds no student, academic or money permissions.',
    // An account administrator does not need to read children's records to do their job, and
    // giving them that access by habit is how "admin" quietly becomes "everything".
    permissions: ['users.view', 'users.manage', 'roles.manage', 'audit.view', 'school.branding'],
  },
];

/**
 * The proprietor holds every permission, always.
 *
 * Not a preset: it is not editable, and it cannot be narrowed. Every school needs one account
 * that can always reach everything, or a mis-set role locks the owner out of their own school
 * with nobody able to undo it.
 */
export const OWNER_HOLDS_EVERYTHING = true;

export function permissionsForOwner(): string[] {
  return [...ALL_PERMISSIONS];
}

/**
 * Can `granter` give away `codes`?
 *
 * You cannot grant what you do not hold. Without this, anyone with `users.manage` could invent a
 * role with `fees.record_payment`, assign it to themselves, and quietly become a cashier — which
 * would make every other separation in this file decorative.
 */
export function canGrant(granterPermissions: string[], codes: string[]): string[] {
  const held = new Set(granterPermissions);
  return codes.filter((c) => !held.has(c));
}
