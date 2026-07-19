import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPublishedSecret, jwtSecret } from './auth';

/**
 * These read `process.env` at call time, so each test sets it and puts it back. A leaked
 * NODE_ENV=production would otherwise fail unrelated specs in confusing ways.
 */
const saved = { ...process.env };
beforeEach(() => {
  delete process.env.JWT_SECRET;
  delete process.env.NODE_ENV;
});
afterEach(() => {
  process.env = { ...saved };
});

describe('jwtSecret', () => {
  it('refuses to run in production without a key', () => {
    process.env.NODE_ENV = 'production';
    expect(() => jwtSecret()).toThrow(/must be set/);
  });

  it('refuses the placeholder from .env.example, which is public', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'change-me-in-production';
    // Being set is not being secret — a deploy that copied the example file is the likeliest
    // way to end up with a signing key an attacker already has.
    expect(() => jwtSecret()).toThrow(/public in this repository/);
  });

  it('refuses the development fallback if it is passed explicitly', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'dev-secret-do-not-use-in-prod';
    expect(() => jwtSecret()).toThrow(/public in this repository/);
  });

  it('accepts a real key', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'MOfN0y0Y0nKGz6h2yQ1B2rTn7hV8pXk9wLq3sD5aZcE=';
    expect(jwtSecret()).toBe('MOfN0y0Y0nKGz6h2yQ1B2rTn7hV8pXk9wLq3sD5aZcE=');
  });

  it('falls back outside production, so a bare checkout still runs', () => {
    expect(jwtSecret()).toBe('dev-secret-do-not-use-in-prod');
  });

  it('knows the published values, whitespace and all', () => {
    expect(isPublishedSecret('  change-me-in-production  ')).toBe(true);
    expect(isPublishedSecret('dev-platform-secret-do-not-use-in-prod')).toBe(true);
    expect(isPublishedSecret('a-key-nobody-has-published')).toBe(false);
  });
});
