/**
 * "Who in this school can do X" — as a database query rather than a guess at job titles.
 *
 * Two places used to answer this by listing legacy roles: the timetable's teacher picker asked for
 * `role in (TEACHER, HEAD, OWNER)`, and the fee-reminder job looked for an `(OWNER, HEAD, BURSAR)`
 * to act as. Both were already wrong before the enum stopped being a job title — a school whose
 * exams officer marks, or whose accounts clerk chases fees, had people the query could not see,
 * and no error to say so. They are the quiet kind of wrong: a name simply missing from a list.
 *
 * This mirrors `effectivePermissions` exactly, and must keep mirroring it:
 * - the proprietor holds everything, unconditionally and un-narrowably;
 * - otherwise the staff role grants, personal extras widen;
 * - and a personal revocation wins over both.
 */
import type { Prisma } from '@prisma/client';

export function holdersOf(code: string): Prisma.UserWhereInput {
  return {
    OR: [
      // Never filtered by revocations: the proprietor's authority is not narrowable, and a stray
      // revoked row on their account must not quietly drop them out of a roster.
      { role: 'OWNER' },
      {
        AND: [
          {
            OR: [
              { staffRole: { permissions: { has: code } } },
              { extraPermissions: { has: code } },
            ],
          },
          { NOT: { revokedPermissions: { has: code } } },
        ],
      },
    ],
  };
}
