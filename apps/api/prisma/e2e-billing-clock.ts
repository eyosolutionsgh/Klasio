/**
 * Move a school's subscription clock, for end-to-end tests only.
 *
 * A subscription period is a term long, so "what happens when this lapses?" is not a question
 * a test can answer by waiting. This drags `periodStart`/`periodEnd` into the past so the next
 * sign-in — which calls `applyDueChanges` before it reads the tier — sees an expired period.
 *
 * It writes nothing a paying school would not eventually write itself: no tier is touched, no
 * status is invented. The point is to observe what the product does with an expired period, so
 * anything this script decided on the product's behalf would make the observation worthless.
 *
 *   ts-node --transpile-only prisma/e2e-billing-clock.ts <slug> expire [daysAgo]
 *   ts-node --transpile-only prisma/e2e-billing-clock.ts <slug> show
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const [slug, action, arg] = process.argv.slice(2);
  if (!slug || !action) throw new Error('usage: e2e-billing-clock <slug> <expire|show> [daysAgo]');

  const school = await db.school.findUniqueOrThrow({
    where: { slug },
    select: { id: true, name: true, tier: true },
  });

  if (action === 'expire') {
    // Far enough back to clear the 14-day grace `isEntitled` allows, so this is an unambiguous
    // lapse rather than a school whose renewal is merely a few days late.
    const daysAgo = Number(arg ?? 30);
    const sub = await db.subscription.findUnique({ where: { schoolId: school.id } });
    if (!sub) throw new Error(`${school.name} has no subscription to expire`);

    const end = new Date(Date.now() - daysAgo * DAY);
    const start = new Date(end.getTime() - 122 * DAY);
    await db.subscription.update({
      where: { id: sub.id },
      data: { periodStart: start, periodEnd: end },
    });
  }

  const sub = await db.subscription.findUnique({
    where: { schoolId: school.id },
    select: { tier: true, status: true, pendingTier: true, periodStart: true, periodEnd: true },
  });
  const fresh = await db.school.findUniqueOrThrow({
    where: { id: school.id },
    select: { tier: true },
  });

  console.log(
    JSON.stringify({
      school: school.name,
      schoolTier: fresh.tier,
      subscription: sub,
      expired: sub ? sub.periodEnd.getTime() < Date.now() : null,
    }),
  );
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
