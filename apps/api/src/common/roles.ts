/**
 * Who may administer whom.
 *
 * Kept pure so the privilege rules can be unit-tested without a database.
 *
 * These rules used to run on the legacy `Role` enum alone: only OWNER and HEAD could touch a staff
 * account, and rank decided the rest. That predates permissions being the unit of authority, and
 * it quietly made a whole job impossible — a school's system administrator holds `users.manage`
 * but sits on no leadership role, so every route refused them before their permissions were ever
 * consulted. The advertised "IT Administrator" preset could not create a single account.
 *
 * So: **who may administer staff is a permission** (`users.manage`), like everything else.
 * The enum keeps exactly one job, the one it is genuinely good for — protecting the proprietor.
 * Only a proprietor may create another proprietor or manage one, however much an administrator
 * holds, because that is the account nobody can narrow and the school's last way back in.
 */
import type { Role } from '@prisma/client';

/**
 * Roles that get a staff login. GUARDIAN is deliberately excluded — guardians are not staff and
 * sign in to their own portal.
 *
 * The four job titles are history, not choices: they belong to accounts created before the
 * account-type choice was retired, and are listed here so those people keep appearing in the staff
 * list. Nothing creates them any more.
 */
export const STAFF_ROLES: Role[] = ['OWNER', 'STAFF', 'HEAD', 'BURSAR', 'TEACHER', 'FRONT_DESK'];

/**
 * What a new staff account is.
 *
 * A school says what someone *does* by giving them a staff role; being asked to also pick a job
 * title that grants nothing produced accounts labelled things they were not — the system
 * administrator filed under "front desk" being the one that gave the game away.
 */
export const DEFAULT_STAFF_ROLE: Role = 'STAFF';

/** Just enough of `AuthUser` to decide, so this file stays pure and testable. */
export interface Actor {
  role: Role | string;
  permissions?: string[];
}

export function isStaffRole(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}

export function isOwner(actor: Actor): boolean {
  return actor.role === 'OWNER';
}

/** May `actor` administer staff accounts at all? */
export function canAdministerStaff(actor: Actor): boolean {
  return isOwner(actor) || (actor.permissions?.includes('users.manage') ?? false);
}

/**
 * May `actor` put someone on the legacy `target` role?
 *
 * The proprietor's rank rule survives on its own: a head teacher — or an administrator — minting
 * an OWNER account would be minting an account that cannot afterwards be narrowed by anyone.
 */
export function canAssignRole(actor: Actor, target: Role): boolean {
  if (!canAdministerStaff(actor)) return false;
  if (!isStaffRole(target)) return false;
  if (target === 'OWNER') return isOwner(actor);
  return true;
}

/** May `actor` edit, deactivate or reset a user who currently holds `target`? */
export function canManageUser(actor: Actor, target: Role): boolean {
  if (!canAdministerStaff(actor)) return false;
  if (target === 'OWNER') return isOwner(actor);
  return true;
}

/** Human-readable label for UI and audit detail. */
export function roleLabel(role: Role): string {
  return role.toLowerCase().replace('_', ' ');
}
