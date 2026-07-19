import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * Where a school's server posts its daily licence summary.
 *
 * ## Unauthenticated, deliberately
 *
 * There is no credential a school could present that it did not also have to be given, stored, and
 * eventually leak. And the report is not a claim worth defending: nothing here grants anything, so
 * a forged heartbeat buys an attacker the ability to tell the vendor a lie about a school that is
 * not theirs. What it would cost to prevent — a per-school shared secret, provisioned and rotated
 * across every deployment — is far more than that is worth.
 *
 * What matters is that this route can only ever *write* an observation. It does not decide
 * anything, it cannot change a licence, and everything it accepts is treated as a claim rather
 * than a fact.
 *
 * ## Unknown schools are recorded, not rejected
 *
 * A report for a slug with no client row is exactly the interesting case — a deployment nobody
 * sold, or a slug that does not match what was agreed. Dropping it would hide it.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : null);
  const num = (k: string) => (typeof body[k] === 'number' ? (body[k] as number) : null);
  const tier = (k: string) => {
    const v = str(k);
    return v === 'BASIC' || v === 'MEDIUM' || v === 'ADVANCED' ? v : null;
  };

  const schoolSlug = str('schoolSlug');
  const client = schoolSlug ? await db.client.findUnique({ where: { slug: schoolSlug } }) : null;

  await db.heartbeat.create({
    data: {
      clientId: client?.id ?? null,
      schoolSlug,
      licenceId: str('licenceId'),
      state: str('state'),
      tierInForce: tier('tierInForce'),
      tierLicensed: tier('tierLicensed'),
      students: num('students'),
      studentCap: num('studentCap'),
      verifiedWith: str('verifiedWith'),
      appVersion: str('appVersion'),
      // Kept whole: a payload that grows a field should still be recoverable from what we stored.
      raw: body as never,
    },
  });

  /*
    202, and nothing in the body.
    
    The school does not act on the answer — the sender records ok/failed and moves on — so there is
    nothing useful to say, and anything said here would be a temptation to make it meaningful later.
  */
  return new NextResponse(null, { status: 202 });
}
