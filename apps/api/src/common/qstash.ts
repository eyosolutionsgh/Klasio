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
  // Half-configured is the case worth naming. Neither variable set is an ordinary deployment that
  // does not use QStash and must stay silent; a token with nowhere to call back to is somebody who
  // meant to use it, and the cost of saying nothing is a schedule that never runs and never
  // explains itself.
  if (process.env.QSTASH_TOKEN && !callbackBase()) {
    input.log.warn(
      `QStash is configured but API_PUBLIC_URL is not set, so "${input.scheduleId}" was not ` +
        "registered and this job will not run. Set it to the API's stable public URL — the same " +
        'address payment gateways are given for their webhooks.',
    );
    return false;
  }
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

/**
 * The exact bytes QStash signed.
 *
 * `rawBody` is the right answer and is what a self-hosted deployment provides — Nest is created
 * with `rawBody: true` for this and for gateway webhooks. Vercel parses the request before Nest
 * sees it, so there it is absent, and Express has already turned the empty body QStash sent into
 * `{}`. Re-serialising that verified `"{}"` against a signature computed over `""`, which fails
 * every time, deterministically, and reads as a rejected credential rather than a mangled body.
 *
 * An absent rawBody therefore means empty, not unknown: `ensureSchedule` registers these schedules
 * with no body, so there is nothing else it could have been. If a schedule ever carries a payload,
 * this has to change with it — hence the assumption stated here rather than buried in a handler.
 */
export function signedBodyOf(req: { rawBody?: Buffer }): string {
  return req.rawBody ? req.rawBody.toString('utf8') : '';
}

/**
 * Why a callback was rejected, in the terms that actually distinguish the causes.
 *
 * A 401 on a QStash callback has three quite different meanings — no signing key configured, no
 * signature sent, or a signature over bytes that are not the bytes we verified — and the response
 * is identical in all three. This says which, without printing the signature, whose whole value is
 * that it is not written down anywhere.
 *
 * `rawBody` is the one worth watching: QStash signs exactly what it sent, and a platform that
 * parses the request before the framework sees it leaves us reconstructing the body and verifying
 * against something the sender never signed.
 */
export function describeRejectedCallback(input: {
  label: string;
  signature?: string;
  rawBody?: Buffer;
  verifiedOver: string;
}): string {
  return [
    `QStash callback "${input.label}" rejected:`,
    `signingKey=${qstashConfigured() ? 'set' : 'MISSING'}`,
    `signatureHeader=${input.signature ? 'present' : 'MISSING'}`,
    `rawBody=${input.rawBody ? `${input.rawBody.length}B` : 'ABSENT (reconstructed)'}`,
    `verifiedOver=${JSON.stringify(input.verifiedOver.slice(0, 40))}`,
    `(${input.verifiedOver.length}B)`,
  ].join(' ');
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
