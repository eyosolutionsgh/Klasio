/**
 * The MailerSend response contract.
 *
 * Every assertion here encodes a way the integration looks correct and silently delivers nothing:
 * a success that is 202-with-an-empty-body rather than 200-with-JSON, an id that arrives in a
 * header, and a 422 that is the *expected* failure whenever a sending domain is not verified.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailService } from './email.module';
import { RenderedEmail } from '../common/email-templates';

const MESSAGE: RenderedEmail = { subject: 'Subject', html: '<p>Body</p>', text: 'Body' };

const ENV_KEYS = [
  'MAILERSEND_API_TOKEN',
  'MAILERSEND_FROM_EMAIL',
  'MAILERSEND_FROM_NAME',
  'MAILERSEND_REPLY_TO',
  'NODE_ENV',
  'ALLOW_MOCK_EMAIL',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  vi.useFakeTimers();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Boot a service with MailerSend configured, and hand back the fetch spy it will use. */
function live(responses: Response[]) {
  process.env.MAILERSEND_API_TOKEN = 'test-token';
  process.env.MAILERSEND_FROM_EMAIL = 'noreply@school.test';
  process.env.MAILERSEND_FROM_NAME = 'Klasio';
  delete process.env.MAILERSEND_REPLY_TO;
  const fetchSpy = vi.fn<typeof fetch>();
  for (const r of responses) fetchSpy.mockResolvedValueOnce(r);
  vi.stubGlobal('fetch', fetchSpy);
  return { svc: new EmailService(), fetchSpy };
}

const accepted = (id = '5e42957d51f1d94a1070a733') =>
  new Response(null, { status: 202, headers: { 'x-message-id': id } });

const send = (svc: EmailService, to = 'head@school.test') =>
  svc.send({ to, toName: 'Ama Mensah', message: MESSAGE, kind: 'test' });

describe('provider selection', () => {
  it('uses the mock when no token is configured', () => {
    delete process.env.MAILERSEND_API_TOKEN;
    delete process.env.MAILERSEND_FROM_EMAIL;
    process.env.NODE_ENV = 'development';
    expect(new EmailService().providerName).toBe('mock');
  });

  it('uses MailerSend once a token and sender are configured', () => {
    expect(live([]).svc.providerName).toBe('mailersend');
  });

  it('needs both the token and the sender — a token alone is not enough to send', () => {
    process.env.MAILERSEND_API_TOKEN = 'test-token';
    delete process.env.MAILERSEND_FROM_EMAIL;
    process.env.NODE_ENV = 'development';
    expect(new EmailService().providerName).toBe('mock');
  });

  /**
   * The guard that stops a deploy from silently swallowing every invitation and reset. Unlike
   * SMS there is no credit balance to notice draining, so a mocked production has no symptom.
   */
  it('refuses to boot unconfigured in production', () => {
    delete process.env.MAILERSEND_API_TOKEN;
    delete process.env.MAILERSEND_FROM_EMAIL;
    delete process.env.ALLOW_MOCK_EMAIL;
    process.env.NODE_ENV = 'production';
    expect(() => new EmailService()).toThrow(/No email provider configured/);
  });

  it('allows a deliberately mocked production when the escape hatch is set', () => {
    delete process.env.MAILERSEND_API_TOKEN;
    delete process.env.MAILERSEND_FROM_EMAIL;
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_MOCK_EMAIL = 'true';
    expect(new EmailService().providerName).toBe('mock');
  });
});

describe('request shape', () => {
  it('posts to the v1 email endpoint with the bearer token', async () => {
    const { svc, fetchSpy } = live([accepted()]);
    await send(svc);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.mailersend.com/v1/email');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('sends both an html and a text body', async () => {
    const { svc, fetchSpy } = live([accepted()]);
    await send(svc);
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    // A missing text/plain alternative is most of what sends transactional mail to spam.
    expect(body.html).toBe(MESSAGE.html);
    expect(body.text).toBe(MESSAGE.text);
    expect(body.subject).toBe(MESSAGE.subject);
  });

  it('names the recipient when a name is known, and omits the key when it is not', async () => {
    const { svc, fetchSpy } = live([accepted(), accepted()]);
    await send(svc);
    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string).to[0]).toEqual({
      email: 'head@school.test',
      name: 'Ama Mensah',
    });

    await svc.send({ to: 'a@b.test', message: MESSAGE, kind: 'test' });
    expect(JSON.parse(fetchSpy.mock.calls[1][1]!.body as string).to[0]).toEqual({
      email: 'a@b.test',
    });
  });

  it('sends an inline image as a base64 attachment the html can reference', async () => {
    const { svc, fetchSpy } = live([accepted()]);
    const content = Buffer.from('crest-bytes');
    await svc.send({
      to: 'a@b.test',
      kind: 'test',
      message: {
        ...MESSAGE,
        html: '<img src="cid:school-crest" />',
        inlineImages: [{ id: 'school-crest', filename: 'crest.png', content }],
      },
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.attachments).toEqual([
      {
        id: 'school-crest',
        filename: 'crest.png',
        // `disposition: inline` is what makes this an embedded image rather than a file the
        // recipient has to download; without it the message shows a paperclip and no crest.
        disposition: 'inline',
        content: content.toString('base64'),
      },
    ]);
  });

  it('omits attachments entirely when there are no inline images', async () => {
    const { svc, fetchSpy } = live([accepted()]);
    await send(svc);
    // An empty array is a validation error, not a no-op.
    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)).not.toHaveProperty('attachments');
  });

  it('omits reply_to entirely when none is configured', async () => {
    const { svc, fetchSpy } = live([accepted()]);
    await send(svc);
    // An empty-string reply_to is a validation error, not a no-op.
    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)).not.toHaveProperty('reply_to');
  });
});

describe('response handling', () => {
  it('treats 202 with an empty body as success and reads the id from the header', async () => {
    const { svc } = live([accepted('abc123')]);
    await expect(send(svc)).resolves.toEqual({ ok: true, ref: 'abc123' });
  });

  it('succeeds even when the id header is absent', async () => {
    const { svc } = live([new Response(null, { status: 202 })]);
    await expect(send(svc)).resolves.toEqual({ ok: true, ref: undefined });
  });

  /**
   * The trap this whole file exists for. A 200 is not how MailerSend reports a queued send, so
   * an implementation keying on `res.ok` would report success for a response that queued nothing.
   */
  it('does not treat a 200 as a successful send', async () => {
    const { svc } = live([new Response('{}', { status: 200 })]);
    await expect(send(svc)).resolves.toMatchObject({ ok: false });
  });

  it('surfaces the 422 body, which is where an unverified sending domain shows up', async () => {
    const detail = JSON.stringify({
      message: 'The given data was invalid.',
      errors: { 'from.email': ['The from.email domain must be verified. #MS42207'] },
    });
    const { svc } = live([new Response(detail, { status: 422 })]);
    const result = await send(svc);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('422');
    expect(result.error).toContain('MS42207');
  });

  it('does not retry a 422 — the same request can never be accepted', async () => {
    const { svc, fetchSpy } = live([new Response('bad', { status: 422 })]);
    await send(svc);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 401 — a bad token would just be hammered', async () => {
    const { svc, fetchSpy } = live([new Response('unauthorised', { status: 401 })]);
    await send(svc);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('transient failures', () => {
  it('retries once after a 429 and succeeds', async () => {
    const { svc, fetchSpy } = live([
      new Response('rate limited', { status: 429, headers: { 'retry-after': '1' } }),
      accepted('after-retry'),
    ]);
    const promise = send(svc);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toEqual({ ok: true, ref: 'after-retry' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('waits at most the ceiling, however long the provider asks for', async () => {
    const { svc, fetchSpy } = live([
      new Response('rate limited', { status: 429, headers: { 'retry-after': '3600' } }),
      accepted(),
    ]);
    const promise = send(svc);
    // An hour-long sleep inside a request handler would hang the flow that triggered the send.
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toMatchObject({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries a 500', async () => {
    const { svc, fetchSpy } = live([new Response('boom', { status: 500 }), accepted()]);
    const promise = send(svc);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toMatchObject({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('gives up after one retry rather than looping', async () => {
    const { svc, fetchSpy } = live([
      new Response('boom', { status: 500 }),
      new Response('boom', { status: 500 }),
    ]);
    const promise = send(svc);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toMatchObject({ ok: false });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  /**
   * Email is a side effect of flows that must still succeed without it: an invitation is a valid
   * row whether or not its notification landed.
   */
  it('never throws when the network is down', async () => {
    process.env.MAILERSEND_API_TOKEN = 'test-token';
    process.env.MAILERSEND_FROM_EMAIL = 'noreply@school.test';
    const fetchSpy = vi.fn<typeof fetch>().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchSpy);
    const svc = new EmailService();
    const promise = send(svc);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toMatchObject({ ok: false, error: 'ECONNREFUSED' });
  });
});
