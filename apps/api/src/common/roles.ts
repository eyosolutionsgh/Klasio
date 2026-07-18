/**
 * Who may manage whom, and which roles they may hand out.
 *
 * Kept pure so the privilege rules can be unit-tested without a database. The guard that
 * matters: an administrator can never create or promote someone *above* their own level, so a
 * head teacher cannot mint an owner account and take over the school.
 */
import type { Role } from '@prisma/client';

/** Roles that get a staff login. GUARDIAN is deliberately excluded — guardians are not staff
 *  and have no login yet (the guardian portal is a separate phase). */
export const STAFF_ROLES: Role[] = ['OWNER', 'HEAD', 'BURSAR', 'TEACHER', 'FRONT_DESK'];

const RANK: Record<Role, number> = {
  OWNER: 3,
  HEAD: 2,
  BURSAR: 1,
  TEACHER: 1,
  FRONT_DESK: 1,
  GUARDIAN: 0,
  // Students never act on staff routes; ranked lowest so they can never administer anyone.
  STUDENT: 0,
};

export function isStaffRole(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}

export function rankOf(role: Role): number {
  return RANK[role] ?? 0;
}

/** Only OWNER/HEAD administer staff at all. */
export function canAdministerStaff(actor: Role): boolean {
  return actor === 'OWNER' || actor === 'HEAD';
}

/**
 * May `actor` grant `target`? Never above their own rank, and never a non-staff role.
 * An OWNER may grant OWNER; a HEAD may grant HEAD and below, but not OWNER.
 */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (!canAdministerStaff(actor)) return false;
  if (!isStaffRole(target)) return false;
  return rankOf(actor) >= rankOf(target);
}

/** May `actor` edit/deactivate a user who currently holds `target`? Same rank rule. */
export function canManageUser(actor: Role, target: Role): boolean {
  if (!canAdministerStaff(actor)) return false;
  return rankOf(actor) >= rankOf(target);
}

/** Human-readable label for UI and audit detail. */
export function roleLabel(role: Role): string {
  return role.toLowerCase().replace('_', ' ');
}
