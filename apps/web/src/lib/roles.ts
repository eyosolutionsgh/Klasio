/**
 * The words a school uses for its own staff.
 *
 * The legacy role enum is engineering vocabulary — OWNER, HEAD, FRONT_DESK — and lowercasing it
 * ("owner", "head", "front desk") is not English a head teacher would write. A Ghanaian private
 * school says proprietor, head teacher, bursar. One map, so the staff list, the role dropdown and
 * the statutory returns never name the same person three different ways.
 */
export const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Proprietor',
  HEAD: 'Head teacher',
  BURSAR: 'Bursar',
  TEACHER: 'Teaching staff',
  FRONT_DESK: 'Administrative staff',
  GUARDIAN: 'Guardian accounts',
};

/** Falls back to the raw code rather than inventing a word for a role we do not know. */
export const roleLabel = (role: string): string => ROLE_LABELS[role] ?? role;
