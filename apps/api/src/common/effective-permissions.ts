import { permissionsForOwner, sanitizePermissions } from './permissions';

/**
 * What one person may actually do, right now.
 *
 * Three inputs, resolved in a fixed order. The order is the whole rule, so it is written down
 * rather than left to be inferred from the code:
 *
 * 1. **The proprietor holds everything.** Not negotiable and not narrowable — a school must
 *    always have one account that can reach everything, or a mis-set role locks the owner out of
 *    their own school with nobody able to undo it.
 * 2. **Otherwise, start from the role.** A person with no role holds nothing. Deny by default:
 *    an account whose role was deleted must lose access, not inherit whatever came before.
 * 3. **Then per-person adjustments.** Grants widen, revocations narrow, and **revocations win.**
 *    Taking something away has to be decisive: if a head revokes a permission from one person,
 *    it must not quietly come back because their role also grants it.
 */

export interface PermissionSource {
  /** The legacy coarse role. Only OWNER is special here. */
  role: string;
  /** Permissions from the person's staff role. Empty or absent when they hold none. */
  rolePermissions?: string[] | null;
  extraPermissions?: string[] | null;
  revokedPermissions?: string[] | null;
}

export function effectivePermissions(src: PermissionSource): string[] {
  if (src.role === 'OWNER') return permissionsForOwner();

  const granted = new Set(sanitizePermissions(src.rolePermissions ?? []));
  for (const code of sanitizePermissions(src.extraPermissions ?? [])) granted.add(code);
  // Last, and unconditional.
  for (const code of src.revokedPermissions ?? []) granted.delete(code);

  return [...granted].sort();
}

export function can(src: PermissionSource, code: string): boolean {
  if (src.role === 'OWNER') return true;
  if ((src.revokedPermissions ?? []).includes(code)) return false;
  return (src.rolePermissions ?? []).includes(code) || (src.extraPermissions ?? []).includes(code);
}
