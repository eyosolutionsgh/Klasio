import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The queue's whole value rests on one distinction: a failed *request* is worth retrying, a
 * rejected *response* is not. Getting that backwards either loses a register or retries a
 * validation error forever, so it is tested directly.
 */

const store: { rows: Array<Record<string, unknown>> } = { rows: [] };

// Minimal IndexedDB stand-in — enough to exercise enqueue/pending/remove.
vi.mock('./offline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./offline')>();
  return actual;
});

beforeEach(() => {
  store.rows = [];
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('indexedDB', {
    open: () => {
      const req: Record<string, unknown> = {};
      queueMicrotask(() => {
        (req.onsuccess as () => void)?.();
      });
      Object.defineProperty(req, 'result', {
        get: () => ({
          objectStoreNames: { contains: () => true },
          transaction: () => ({
            objectStore: () => ({
              add: (row: Record<string, unknown>) => {
                const r: Record<string, unknown> = {};
                store.rows.push({ ...row, id: store.rows.length + 1 });
                queueMicrotask(() => (r.onsuccess as () => void)?.());
                return r;
              },
              getAll: () => {
                const r: Record<string, unknown> = { result: store.rows };
                queueMicrotask(() => (r.onsuccess as () => void)?.());
                return r;
              },
              delete: (id: number) => {
                const r: Record<string, unknown> = {};
                store.rows = store.rows.filter((x) => x.id !== id);
                queueMicrotask(() => (r.onsuccess as () => void)?.());
                return r;
              },
            }),
          }),
        }),
      });
      return req;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('submitOrQueue', () => {
  it('sends straight through when the server accepts', async () => {
    const { submitOrQueue, pending } = await import('./offline');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ saved: 2 }) }),
    );
    const res = await submitOrQueue('/api/x', { a: 1 }, 'label');
    expect(res).toMatchObject({ ok: true, queued: false });
    expect(await pending()).toHaveLength(0);
  });

  it('queues when the device is offline, without even trying', async () => {
    const { submitOrQueue, pending } = await import('./offline');
    vi.stubGlobal('navigator', { onLine: false });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await submitOrQueue('/api/x', { a: 1 }, 'Basic 4 register');
    expect(res).toMatchObject({ ok: true, queued: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await pending()).toHaveLength(1);
  });

  it('queues when the network drops mid-request', async () => {
    const { submitOrQueue, pending } = await import('./offline');
    // fetch rejects with TypeError when it cannot reach the host
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const res = await submitOrQueue('/api/x', { a: 1 }, 'label');
    expect(res).toMatchObject({ ok: true, queued: true });
    expect(await pending()).toHaveLength(1);
  });

  it('does NOT queue a rejected response — the server has an opinion', async () => {
    const { submitOrQueue, pending } = await import('./offline');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'No current term configured' }),
      }),
    );
    const res = await submitOrQueue('/api/x', { a: 1 }, 'label');
    expect(res.ok).toBe(false);
    expect(res.queued).toBe(false);
    expect(res.message).toBe('No current term configured');
    expect(await pending()).toHaveLength(0);
  });
});

describe('flush', () => {
  it('replays queued writes oldest-first and clears them', async () => {
    const { enqueue, flush, pending } = await import('./offline');
    await enqueue({ url: '/api/a', method: 'POST', body: { n: 1 }, label: 'first' });
    await enqueue({ url: '/api/b', method: 'POST', body: { n: 2 }, label: 'second' });
    const order: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        order.push(url);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      }),
    );
    const res = await flush();
    expect(order).toEqual(['/api/a', '/api/b']);
    expect(res.synced).toBe(2);
    expect(await pending()).toHaveLength(0);
  });

  it('stops at a network failure so ordering survives', async () => {
    const { enqueue, flush, pending } = await import('./offline');
    await enqueue({ url: '/api/a', method: 'POST', body: {}, label: 'first' });
    await enqueue({ url: '/api/b', method: 'POST', body: {}, label: 'second' });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockRejectedValueOnce(new TypeError('Failed to fetch')),
    );
    const res = await flush();
    expect(res.synced).toBe(1);
    expect(await pending()).toHaveLength(1); // the second is still waiting
  });

  it('drops a write the server will never accept rather than blocking the queue behind it', async () => {
    const { enqueue, flush, pending } = await import('./offline');
    await enqueue({ url: '/api/bad', method: 'POST', body: {}, label: 'doomed' });
    await enqueue({ url: '/api/good', method: 'POST', body: {}, label: 'fine' });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }),
    );
    const res = await flush();
    expect(res.failed).toBe(1);
    expect(res.synced).toBe(1);
    expect(await pending()).toHaveLength(0);
  });
});
