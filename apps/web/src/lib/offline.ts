/**
 * Offline write queue (docs/02 §2.10 — "local queue, sync on reconnect", all tiers).
 *
 * Ghanaian school networks drop. A teacher halfway through a register must not lose the work,
 * and must not have to know whether the connection is up. So every queued write is stored in
 * IndexedDB and replayed in order when the network returns.
 *
 * This is only safe because the endpoints it queues are idempotent — attendance is keyed on
 * (student, date) and scores on (student, component, term), so replaying a write produces the
 * same row rather than a duplicate. Do not queue anything that appends (payments, ledger
 * entries): a replay would take money twice.
 *
 * Pickup release and morning check-in are the appends that are queued, and only because they
 * were made idempotent first: the gate device mints a `clientRef` before sending, and the server
 * returns the existing row rather than writing a second one. The rule is not "never queue an
 * append" — it is "never queue a write that a replay would duplicate". Make it safe first, then
 * queue it.
 */

const DB_NAME = 'eyo-offline';
const STORE = 'queue';
const VERSION = 1;

export interface QueuedOp {
  id?: number;
  url: string;
  method: string;
  body: unknown;
  /** Shown to the user, e.g. "Basic 4 register · 18 Jul". */
  label: string;
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const store = db.transaction(STORE, mode).objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(op: Omit<QueuedOp, 'id' | 'createdAt'>) {
  await tx('readwrite', (s) => s.add({ ...op, createdAt: Date.now() }));
}

export async function pending(): Promise<QueuedOp[]> {
  const all = await tx<QueuedOp[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedOp[]>);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

async function remove(id: number) {
  await tx('readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>);
}

/** True when the failure was the network rather than the server saying no. */
function isNetworkError(err: unknown) {
  return err instanceof TypeError; // fetch rejects with TypeError when it cannot reach the host
}

export interface SubmitResult {
  ok: boolean;
  queued: boolean;
  /** Present when the server answered. */
  status?: number;
  body?: unknown;
  message?: string;
}

/**
 * Send now, or keep it for later.
 *
 * A rejected *request* (no network) is queued. A rejected *response* — 400, 403, 409 — is not:
 * the server has an opinion and retrying forever would bury it. That distinction is the whole
 * reason this is not a blind retry loop.
 */
export async function submitOrQueue(
  url: string,
  body: unknown,
  label: string,
  method = 'POST',
): Promise<SubmitResult> {
  /**
   * Stamp the moment the user acted, not the moment this reaches the server.
   *
   * A queued register can replay days later, and arrival order is not the order things happened:
   * a mark made at 09:00 must not overwrite a correction the office made at 10:00 simply because
   * the device reconnected at 11:00. The server compares this against what it already holds and
   * skips the ones it has since been told better about — see common/replay.ts on the API side.
   *
   * Sent on the online path too, so both paths are judged on the same clock. Endpoints that do
   * not declare `recordedAt` drop it silently, because the API validates with `whitelist: true`.
   */
  const stamped =
    body && typeof body === 'object' && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>), recordedAt: new Date().toISOString() }
      : body;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await enqueue({ url, method, body: stamped, label });
    return { ok: true, queued: true };
  }
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stamped),
    });
    const parsed = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        queued: false,
        status: res.status,
        body: parsed,
        message:
          (parsed as { message?: string | string[] }).message instanceof Array
            ? (parsed as { message: string[] }).message.join('. ')
            : ((parsed as { message?: string }).message ?? 'That did not save.'),
      };
    }
    return { ok: true, queued: false, status: res.status, body: parsed };
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueue({ url, method, body: stamped, label });
      return { ok: true, queued: true };
    }
    return { ok: false, queued: false, message: 'That did not save.' };
  }
}

/** A write the server refused outright, named so the user knows what was lost. */
export interface FlushFailure {
  label: string;
  status: number;
  message: string;
}

export interface FlushResult {
  synced: number;
  failed: number;
  remaining: number;
  /** What was discarded, and why. Empty when nothing was. */
  failures: FlushFailure[];
  /** Replay stopped because the session has expired — nothing was lost, but a sign-in is needed. */
  needsSignIn: boolean;
}

/**
 * Replay the queue oldest-first, stopping at the first network failure so order is preserved.
 *
 * A write the server rejects outright is dropped rather than retried forever — it would never
 * succeed, and holding it blocks everything behind it. **Except 401**, which is the one refusal
 * that says nothing about the write at all.
 *
 * That exception is the whole point of this function's history. A teacher marks three registers
 * offline on Friday afternoon; the device stays off the network over the weekend; the 12-hour
 * session cookie expires; Monday's reconnect replays them, the proxy answers 401 because there is
 * no cookie, and all three were deleted from IndexedDB — work that would have saved perfectly a
 * moment after signing in. Now the queue is kept, the loop stops (everything behind it would get
 * the same answer), and the caller is told to sign in.
 */
export async function flush(): Promise<FlushResult> {
  const ops = await pending();
  let synced = 0;
  const failures: FlushFailure[] = [];
  let needsSignIn = false;

  for (const op of ops) {
    try {
      const res = await fetch(op.url, {
        method: op.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(op.body),
      });
      if (res.ok) {
        await remove(op.id!);
        synced++;
      } else if (res.status === 401) {
        // Not the write's fault. Keep it and stop — the rest would fail the same way.
        needsSignIn = true;
        break;
      } else if (res.status >= 400 && res.status < 500) {
        // The server will never accept this. Drop it, but say which one and why — a bare count
        // of "1 discarded" tells a teacher nothing about which register to re-enter.
        const parsed = (await res.json().catch(() => ({}))) as { message?: string | string[] };
        failures.push({
          label: op.label,
          status: res.status,
          message: Array.isArray(parsed.message)
            ? parsed.message.join('. ')
            : (parsed.message ?? 'The server rejected it.'),
        });
        await remove(op.id!);
      } else {
        break; // server trouble — keep it and try again later
      }
    } catch {
      break; // still offline
    }
  }
  return {
    synced,
    failed: failures.length,
    failures,
    needsSignIn,
    remaining: (await pending()).length,
  };
}
