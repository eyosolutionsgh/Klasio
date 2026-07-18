import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { objectKey, resetStorage, storage } from './storage';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eyo-storage-'));
  delete process.env.STORAGE_S3_BUCKET;
  process.env.STORAGE_LOCAL_DIR = dir;
  resetStorage();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.STORAGE_S3_BUCKET;
  resetStorage();
});

describe('storage adapter selection', () => {
  it('falls back to local disk when no bucket is configured', () => {
    expect(storage().kind).toBe('LOCAL');
  });

  it('selects S3 when a bucket is configured', () => {
    process.env.STORAGE_S3_BUCKET = 'eyo-test';
    resetStorage();
    expect(storage().kind).toBe('S3');
  });
});

describe('local disk provider', () => {
  it('round-trips an object', async () => {
    const s = storage();
    const body = Buffer.from('hello ghana');
    await s.put('schools/s1/students/x/a.png', body, 'image/png');
    expect((await s.get('schools/s1/students/x/a.png')).toString()).toBe('hello ghana');
  });

  it('deletes an object', async () => {
    const s = storage();
    await s.put('schools/s1/doc.pdf', Buffer.from('x'), 'application/pdf');
    await s.delete('schools/s1/doc.pdf');
    await expect(s.get('schools/s1/doc.pdf')).rejects.toThrow();
  });

  it('refuses keys that escape the storage root', async () => {
    const s = storage();
    await expect(s.put('../../etc/passwd', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      /Invalid storage key/,
    );
    await expect(s.get('../../../etc/hosts')).rejects.toThrow(/Invalid storage key/);
  });
});

describe('object keys', () => {
  it('scopes by school and randomises the filename', () => {
    const a = objectKey('school1', 'students', 'stu1', 'photo.JPG');
    const b = objectKey('school1', 'students', 'stu1', 'photo.JPG');
    expect(a.startsWith('schools/school1/students/stu1/')).toBe(true);
    expect(a.endsWith('.jpg')).toBe(true);
    // Two uploads of the same filename must not collide or be guessable.
    expect(a).not.toBe(b);
  });

  it('sanitises hostile extensions', () => {
    const k = objectKey('s', 'documents', 'd', 'evil.php%00.png');
    expect(k).toMatch(/\.png$/);
  });
});
