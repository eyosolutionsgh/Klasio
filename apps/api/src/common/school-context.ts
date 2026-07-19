/**
 * Which school this box is.
 *
 * One school per deployment, so the answer is "the one row in School" — but there is no request,
 * no token and no tenant context at the moment it is needed. The login page has to render a crest
 * and a name before anyone has signed in, and the setup wizard has to know whether it has already
 * run.
 *
 * This is a legitimate use of `db.system`, the same category as sign-in resolving an email across
 * schools: there is genuinely no tenant yet, so there is nothing for a policy to compare against.
 * Everything downstream of it still goes through `withTenant`.
 */
import type { PrismaService } from '../prisma/prisma.service';

/** Cached because it is read on every unauthenticated page load and can only change once, ever. */
let cachedId: string | null = null;

export interface SchoolContext {
  id: string;
  name: string;
  slug: string;
  brandColor: string | null;
  hasLogo: boolean;
  motto: string | null;
}

/** The school on this box, or null before the setup wizard has run. */
export async function singletonSchool(db: PrismaService): Promise<SchoolContext | null> {
  const school = await db.system.school.findFirst({
    // Oldest wins. There should only ever be one, but if a restore or a botched migration left a
    // second, resolving to the original beats resolving to whichever Postgres returned first.
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      brandColor: true,
      logoUrl: true,
      motto: true,
    },
  });
  if (!school) return null;
  cachedId = school.id;
  const { logoUrl, ...rest } = school;
  return { ...rest, hasLogo: !!logoUrl };
}

export async function singletonSchoolId(db: PrismaService): Promise<string | null> {
  if (cachedId) return cachedId;
  const school = await db.system.school.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  cachedId = school?.id ?? null;
  return cachedId;
}

/** Called when the setup wizard creates the school, so the first read does not miss it. */
export function rememberSchoolId(id: string) {
  cachedId = id;
}

/** Tests only — the cache outlives a truncated database otherwise. */
export function forgetSchoolId() {
  cachedId = null;
}
