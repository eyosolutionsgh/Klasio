/**
 * Verifies inbound Upstash QStash callbacks (docs/10 §5), the serverless alternative to the
 * BullMQ `Worker`s in `payments.module.ts` and `fees.module.ts`. Selected purely by which env var
 * is set — `QSTASH_CURRENT_SIGNING_KEY` here, `REDIS_URL` for BullMQ — so an on-prem or
 * DigitalOcean deployment with its own Redis never touches this path or needs an Upstash account.
 */
import { Client, Receiver } from '@upstash/qstash';

let receiver: Receiver | undefined;

export function qstashConfigured(): boolean {
  return Boolean(process.env.QSTASH_CURRENT_SIGNING_KEY);
}

/**
 * Whether this deployment can *register* schedules, as opposed to merely verifying callbacks.
 *
 * Separate from `qstashConfigured()` on purpose: the signing keys verify what arrives, the token
 * creates what will arrive, and a deployment can hold one without the other. A read-only replica
 * given only the signing keys should answer callbacks without quietly re-pointing the schedules
 * at itself.
 */
function schedulerConfigured(): boolean {
  return Boolean(process.env.QSTASH_TOKEN && callbackBase());
}

/**
 * Where QStash should call back to.
 *
 * `API_PUBLIC_URL` is the same variable the payment gateways are told to use for their webhooks —
 * one answer to "what address is this API reachable at", rather than a second one that can drift
 * from the first. It must be the stable production URL: Vercel's per-deployment URL would leave a
 * schedule pointing at a deployment that the next release replaces.
 */
function callbackBase(): string | undefined {
  const base = process.env.API_PUBLIC_URL || undefined;
  return base?.replace(/\/+$/, '');
}

/**
 * Register a QStash schedule, or do nothing where QStash is not in use.
 *
 * `scheduleId` is deterministic and the create call overwrites an existing schedule with that id,
 * which is what makes this safe to run on a serverless platform: every cold start re-registers the
 * same schedule rather than adding another copy of it, and a changed cron or URL is corrected on
 * the next boot instead of leaving a stale duplicate firing alongside the new one.
 *
 * Failure is logged and swallowed. A schedule that could not be registered costs a sweep that
 * has to be triggered by hand; an exception here would cost the whole API, and the work this
 * drives is a safety net rather than the settlement path itself.
 */
export async function ensureSchedule(input: {
  scheduleId: string;
  path: string;
  cron: string;
  log: { log: (m: string) => void; warn: (m: string) => void };
}): Promise<boolean> {
  if (!schedulerConfigured()) return false;
  const destination = `${callbackBase()}${input.path}`;
  try {
    const client = new Client({ token: process.env.QSTASH_TOKEN! });
    await client.schedules.create({
      destination,
      scheduleId: input.scheduleId,
      cron: input.cron,
    });
    input.log.log(`QStash schedule "${input.scheduleId}" → ${destination} (${input.cron})`);
    return true;
  } catch (e) {
    input.log.warn(
      `Could not register QStash schedule "${input.scheduleId}": ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return false;
  }
}

function client(): Receiver {
  receiver ??= new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY ?? '',
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY ?? '',
  });
  return receiver;
}

/** `body` must be the exact raw bytes received — QStash signs over them, not a re-serialised copy. */
export async function verifyQstashSignature(
  signature: string | undefined,
  body: string,
): Promise<boolean> {
  if (!qstashConfigured() || !signature) return false;
  try {
    return await client().verify({ signature, body });
  } catch {
    return false;
  }
}
