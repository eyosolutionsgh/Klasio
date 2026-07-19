import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  forgetDevLicenceKey,
  InsecureLicenceKeyError,
  licencePublicKey,
  usingDevLicenceKey,
} from './licence-key';

const SRC = join(__dirname, '..');
const VENDOR_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAqAzsR+DXL1akz9DOYFKEdBJc9WnVqyHQSeDU2DyykrU=
-----END PUBLIC KEY-----`;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.ts$/.test(full)) out.push(full);
  }
  return out;
}

afterEach(() => {
  delete process.env.LICENCE_PUBLIC_KEY;
  delete process.env.NODE_ENV;
  delete process.env.LICENCE_DEV_KEY_PATH;
  forgetDevLicenceKey();
});

describe('licence key resolution', () => {
  it('uses the configured vendor key when one is set, in any environment', () => {
    process.env.LICENCE_PUBLIC_KEY = VENDOR_KEY;
    process.env.NODE_ENV = 'production';
    expect(licencePublicKey()).toContain('BEGIN PUBLIC KEY');
    expect(usingDevLicenceKey()).toBe(false);
  });

  it('accepts the vendor key base64-encoded, for env vars that dislike newlines', () => {
    process.env.LICENCE_PUBLIC_KEY = Buffer.from(VENDOR_KEY).toString('base64');
    expect(licencePublicKey()).toContain('BEGIN PUBLIC KEY');
  });

  it('falls back to the development key on a checkout', () => {
    delete process.env.NODE_ENV;
    expect(licencePublicKey()).toContain('BEGIN PUBLIC KEY');
    expect(usingDevLicenceKey()).toBe(true);
  });

  /**
   * docker-compose and CI both send an unset variable through as the empty string. Read with `??`
   * that is a valid override, so the key path became "" — and a developer checkout reported itself
   * as a build carrying no development key, which is the confusing half of a security guard
   * firing on the wrong machine.
   */
  it('treats an empty LICENCE_DEV_KEY_PATH as unset, not as a path', () => {
    process.env.LICENCE_DEV_KEY_PATH = '';
    delete process.env.NODE_ENV;
    forgetDevLicenceKey();

    expect(usingDevLicenceKey()).toBe(true);
    expect(licencePublicKey()).toContain('BEGIN PUBLIC KEY');
  });

  it('refuses the development key when NODE_ENV says production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => licencePublicKey()).toThrow(InsecureLicenceKeyError);
    expect(usingDevLicenceKey()).toBe(false);
  });
});

/**
 * The artifact guard.
 *
 * The dev key's private half is committed, so anyone with this repository can mint a licence it
 * verifies. That is fine until the matching public key is compiled into a shipped build — at which
 * point the only thing between a customer's image and free Advanced is NODE_ENV, which the person
 * running the container sets.
 *
 * The fix is that the dev key lives in `ops/`, which apps/api/Dockerfile never copies. These tests
 * defend that property, because it is invisible: re-inlining the PEM would work perfectly on every
 * developer machine and every CI run, and only be wrong in production.
 */
describe('no key material ships in the build', () => {
  it('has no PEM block anywhere in apps/api/src', () => {
    /*
      Key *material*, not the marker. `licence-key.ts` legitimately names both markers — its
      extractor regex is built from them — and a naive search for "-----BEGIN" flags that as an
      offence. Requiring a newline followed by an actual base64 body tells a real key from a
      pattern that merely describes one.
    */
    const PEM_WITH_BODY = /-----BEGIN [A-Z ]*KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{40,}-----END/;
    const offenders = walk(SRC)
      // This file quotes a real key of its own, as the vendor-key fixture.
      .filter((f) => !f.endsWith('licence-key.spec.ts'))
      .filter((f) => PEM_WITH_BODY.test(readFileSync(f, 'utf8')));

    expect(
      offenders,
      'A key pasted into src/ compiles into dist/ and ships inside the image. Put it under ops/, ' +
        'which the Dockerfile does not copy, and read it at runtime.',
    ).toEqual([]);
  });

  it('refuses outright when the build carries no development key', () => {
    /*
      What a production image looks like: nothing configured, and ops/ absent because the
      Dockerfile never copied it. The answer is a refusal rather than a fallback — and, crucially,
      one that does not depend on NODE_ENV being what the vendor set rather than what the operator
      passed to `docker run`.
    */
    process.env.LICENCE_DEV_KEY_PATH = join(__dirname, 'no-such-key.pem');
    delete process.env.NODE_ENV;
    forgetDevLicenceKey();

    expect(() => licencePublicKey()).toThrow(InsecureLicenceKeyError);
    expect(() => licencePublicKey()).toThrow(/carries no development key/);
    expect(usingDevLicenceKey()).toBe(false);
  });

  it('still honours a vendor key on a build with no development key', () => {
    process.env.LICENCE_DEV_KEY_PATH = join(__dirname, 'no-such-key.pem');
    process.env.NODE_ENV = 'production';
    process.env.LICENCE_PUBLIC_KEY = VENDOR_KEY;
    forgetDevLicenceKey();

    expect(licencePublicKey()).toContain('BEGIN PUBLIC KEY');
  });
});
