/**
 * Verifies inbound Upstash QStash callbacks (docs/10 §5), the serverless alternative to the
 * BullMQ `Worker`s in `payments.module.ts` and `fees.module.ts`. Selected purely by which env var
 * is set — `QSTASH_CURRENT_SIGNING_KEY` here, `REDIS_URL` for BullMQ — so an on-prem or
 * DigitalOcean deployment with its own Redis never touches this path or needs an Upstash account.
 */
import { Receiver } from '@upstash/qstash';

let receiver: Receiver | undefined;

export function qstashConfigured(): boolean {
  return Boolean(process.env.QSTASH_CURRENT_SIGNING_KEY);
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
