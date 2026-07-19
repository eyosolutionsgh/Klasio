/**
 * The Nalo response contract.
 *
 * Nalo answers HTTP 200 for authentication failures, unregistered sender IDs and malformed
 * destinations alike, carrying the real outcome in a plaintext body. Reading `res.ok` as success
 * would record every one of those as SENT and debit the school a credit for it, so the parsing
 * below is what stands between a school and paying for a term of messages that never left.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockSmsProvider, NaloSmsProvider, type SmsProvider } from './sms.module';

const CFG = {
  endpoint: 'https://sms.nalosolutions.com/smsbackend/clientapi/Resl_Nalo/send-message/',
  username: 'user',
  password: 'p@ss word',
  source: 'SCHOOL',
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => vi.restoreAllMocks());

const reply = (body: string, status = 200) => new Response(body, { status });
const sentUrl = () => new URL(fetchSpy.mock.calls[0][0] as URL);
const provider = () => new NaloSmsProvider(CFG);

describe('request', () => {
  it('sends the documented parameter set as a GET', async () => {
    fetchSpy.mockResolvedValue(reply('1701|233554654834|abc'));
    await provider().send('233554654834', 'Hello', 'BRIGHTON');

    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'GET' });
    const url = sentUrl();
    expect(url.searchParams.get('username')).toBe('user');
    expect(url.searchParams.get('type')).toBe('0'); // plain text
    expect(url.searchParams.get('dlr')).toBe('1'); // delivery report requested
    expect(url.searchParams.get('message')).toBe('Hello');
  });

  it('sends to the configured endpoint path unchanged', async () => {
    fetchSpy.mockResolvedValue(reply('1701|x|y'));
    await provider().send('233554654834', 'Hello', '');
    expect(sentUrl().pathname).toBe('/smsbackend/clientapi/Resl_Nalo/send-message/');
  });

  it('percent-encodes credentials, which routinely contain @ and spaces', async () => {
    fetchSpy.mockResolvedValue(reply('1701|x|y'));
    await provider().send('233554654834', 'Hello', '');
    // Read back through URLSearchParams: the raw string must survive a round trip intact.
    expect(sentUrl().searchParams.get('password')).toBe('p@ss word');
  });

  it("prefers the school's own sender id over the configured default", async () => {
    fetchSpy.mockResolvedValue(reply('1701|x|y'));
    await provider().send('233554654834', 'Hello', 'BRIGHTON');
    expect(sentUrl().searchParams.get('source')).toBe('BRIGHTON');
  });

  it('falls back to the configured sender when the school has none', async () => {
    fetchSpy.mockResolvedValue(reply('1701|x|y'));
    await provider().send('233554654834', 'Hello', '');
    expect(sentUrl().searchParams.get('source')).toBe('SCHOOL');
  });
});

describe('destination normalisation', () => {
  it.each([
    ['0554654834', '233554654834'],
    ['+233554654834', '233554654834'],
    ['233 55 465 4834', '233554654834'],
    ['554654834', '233554654834'],
  ])('normalises %s to a bare msisdn', async (input, expected) => {
    fetchSpy.mockResolvedValue(reply('1701|x|y'));
    await provider().send(input, 'Hello', '');
    expect(sentUrl().searchParams.get('destination')).toBe(expected);
  });

  it('never sends the leading +, which Nalo rejects', async () => {
    fetchSpy.mockResolvedValue(reply('1701|x|y'));
    await provider().send('+233554654834', 'Hello', '');
    expect(sentUrl().searchParams.get('destination')).not.toContain('+');
  });

  it('refuses an unusable number without calling the gateway', async () => {
    const result = await provider().send('not a phone', 'Hello', '');
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('response parsing', () => {
  it('treats a 1701 body as success and keeps the reference', async () => {
    fetchSpy.mockResolvedValue(reply('1701|233554654834|4f2c9a'));
    await expect(provider().send('233554654834', 'Hello', '')).resolves.toEqual({
      ok: true,
      ref: '1701|233554654834|4f2c9a',
    });
  });

  it('tolerates the comma-separated variant of the same success code', async () => {
    await expect(
      (fetchSpy.mockResolvedValue(reply('1701,4f2c9a')), provider().send('233554654834', 'H', '')),
    ).resolves.toMatchObject({ ok: true });
  });

  it('ignores surrounding whitespace', async () => {
    fetchSpy.mockResolvedValue(reply('  1701|x|y\n'));
    await expect(provider().send('233554654834', 'H', '')).resolves.toMatchObject({ ok: true });
  });

  /** The one that matters: every Nalo failure arrives as an HTTP 200. */
  it.each([
    ['1702', 'invalid url'],
    ['1703', 'invalid username or password'],
    ['1704', 'invalid type'],
    ['1705', 'invalid message'],
    ['1706', 'invalid destination'],
    ['1707', 'invalid source'],
    ['1025', 'insufficient credit'],
  ])('treats %s (%s) as a failure despite the 200', async (code) => {
    fetchSpy.mockResolvedValue(reply(code, 200));
    const result = await provider().send('233554654834', 'Hello', '');
    expect(result.ok).toBe(false);
    expect(result.error).toBe(code);
  });

  it('does not mistake a code merely containing 1701 for success', async () => {
    fetchSpy.mockResolvedValue(reply('1025|1701'));
    await expect(provider().send('233554654834', 'H', '')).resolves.toMatchObject({ ok: false });
  });

  it('reports the status when the body is empty', async () => {
    fetchSpy.mockResolvedValue(reply('', 502));
    await expect(provider().send('233554654834', 'H', '')).resolves.toEqual({
      ok: false,
      error: 'HTTP 502',
    });
  });

  it('never throws when the network is down', async () => {
    fetchSpy.mockRejectedValue(new Error('ETIMEDOUT'));
    await expect(provider().send('233554654834', 'H', '')).resolves.toEqual({
      ok: false,
      error: 'ETIMEDOUT',
    });
  });
});

describe('mock provider', () => {
  it('reports success without touching the network', async () => {
    // Through the interface, not the class: the mock ignores `sender`, and every caller in the
    // product reaches it as an SmsProvider.
    const mock: SmsProvider = new MockSmsProvider();
    const result = await mock.send('233554654834', 'Hello', '');
    expect(result.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
