/**
 * The licence heartbeat: a daily summary this box sends its supplier, and nothing more.
 *
 * ## What it is not
 *
 * It is **not** an authorisation check. The licence is verified locally against a public key, and
 * that is the only thing that decides what the school can do. If the heartbeat never succeeds —
 * no network, blocked hostname, vendor server down for a month — absolutely nothing changes about
 * how the product behaves. A school on a LAN with no internet is a supported deployment, not a
 * degraded one, and this must never make it otherwise.
 *
 * It is also **off unless `LICENCE_HEARTBEAT_URL` is set**. A box with no URL configured sends
 * nothing, ever, which is the right default for a product sold partly on not phoning home.
 *
 * ## What it is for
 *
 * Signing stops a school editing a licence file. It cannot stop one that rebuilds from source or
 * points `LICENCE_PUBLIC_KEY` at a key it generated — you cannot cryptographically defend a box
 * somebody else owns. What you *can* do is notice. A box reporting `verifiedWith: "development"`,
 * or a licence id that was never sold, or a roll four times the cap, is a conversation to have.
 *
 * And a box that simply stops reporting is itself a signal — which is also the honest limit of
 * this: anyone determined enough to tamper is capable of blocking one hostname. It catches the
 * careless and the opportunistic, not the committed.
 *
 * ## What it may contain
 *
 * Licence facts and one aggregate number. No student names, no guardian details, no addresses, no
 * marks, no fees — nothing about a child, ever. `heartbeatPayload` is a pure function so that
 * promise is testable, and there is a test that fails if the payload ever grows a field that is
 * not on this list.
 */
import type { Tier } from '@prisma/client';
import type { LicenceStatus } from './licence';

/** Which key the box verified its licence against — the field that makes tampering visible. */
export type VerifiedWith = 'vendor' | 'development' | 'none';

export interface HeartbeatPayload {
  /** Format version, so a vendor endpoint can evolve without guessing. */
  v: 1;
  /** The licence being reported on, or null when none is installed. */
  licenceId: string | null;
  /** Which school this box is, as the licence names it. */
  schoolSlug: string | null;
  /** VALID | GRACE | EXPIRED | MISSING | INVALID. */
  state: LicenceStatus['state'];
  /** What the school is actually running on. Differs from `tierLicensed` when a licence lapsed. */
  tierInForce: Tier;
  /** What the licence says it bought. Null when there is no readable licence. */
  tierLicensed: Tier | null;
  /**
   * Active enrolment. One number.
   *
   * Kept after enrolment caps were dropped: it is no longer a limit to police, but it is still
   * how big a school is, which is what a renewal conversation is actually about.
   */
  students: number;
  /**
   * The tamper signal.
   *
   * `development` means this box is verifying licences with the key committed in the public
   * repository — which anyone can mint against. On a real deployment that should be impossible;
   * seeing it means someone has gone out of their way.
   */
  verifiedWith: VerifiedWith;
  /** Which build is running, so a report can be matched to a release. */
  appVersion: string;
  sentAt: string;
}

/**
 * Build the report. Pure, and deliberately so: what leaves a school's server is a decision worth
 * being able to read in one place and assert on in a test.
 */
export function heartbeatPayload(input: {
  status: LicenceStatus;
  students: number;
  verifiedWith: VerifiedWith;
  appVersion: string;
  now?: Date;
}): HeartbeatPayload {
  const { status, students, verifiedWith, appVersion } = input;
  return {
    v: 1,
    licenceId: status.payload?.licenceId ?? null,
    schoolSlug: status.payload?.schoolSlug ?? null,
    state: status.state,
    tierInForce: status.tier,
    tierLicensed: (status.payload?.tier as Tier | undefined) ?? null,
    students,
    verifiedWith,
    appVersion,
    sentAt: (input.now ?? new Date()).toISOString(),
  };
}

export interface HeartbeatResult {
  ok: boolean;
  detail: string;
}

/**
 * POST it, and swallow everything.
 *
 * There is no retry and no queue. A missed heartbeat is not worth complexity: the next one is
 * tomorrow, and the vendor's interest is in a pattern over weeks rather than any single report.
 * The timeout matters more than the result — a hung connection to a vendor host must not leave a
 * handle open on a school's server all day.
 */
export async function sendHeartbeat(
  url: string,
  payload: HeartbeatPayload,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<HeartbeatResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return res.ok
      ? { ok: true, detail: `Reported (${res.status})` }
      : { ok: false, detail: `Supplier returned ${res.status}` };
  } catch (e) {
    // Offline is the expected case on a LAN box, not an error worth alarming anyone about.
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
