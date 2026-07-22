/**
 * The words a school uses for its own staff.
 *
 * Mostly historical now: the account-type choice was retired, so what a person does comes from
 * their staff role ("Bursar", "System Administrator") and these labels only ever describe accounts
 * created before that, plus the two kinds that still mean something — proprietor and staff.
 *
 * The legacy role enum is engineering vocabulary — OWNER, HEAD, FRONT_DESK — and lowercasing it
 * ("owner", "head", "front desk") is not English a head teacher would write. A Ghanaian private
 * school says proprietor, head teacher, bursar. One map, so the staff list, the role dropdown and
 * the statutory returns never name the same person three different ways.
 */
export const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Proprietor',
  STAFF: 'Staff',
  HEAD: 'Head teacher',
  BURSAR: 'Bursar',
  TEACHER: 'Teaching staff',
  FRONT_DESK: 'Administrative staff',
  GUARDIAN: 'Guardian accounts',
};

/** Falls back to the raw code rather than inventing a word for a role we do not know. */
export const roleLabel = (role: string): string => ROLE_LABELS[role] ?? role;
