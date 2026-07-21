/**
 * Learning resources: a media file in at one end, the same bytes streamed out the other.
 *
 * The library's upload path changed shape for media support — disk-buffered multipart, a
 * per-type size cap, and a streamed (not buffered) download — and none of that is visible to
 * the unit suite. What matters here:
 *
 *  - an audio file BIGGER than the 8MB document cap is accepted, because media has its own cap
 *    (the exact regression the old single cap would reintroduce);
 *  - the download route answers with the media content type, a content length, and byte-for-byte
 *    the uploaded content, through the streaming path;
 *  - the document rules did not loosen alongside: oversize documents and unlisted types are
 *    still refused.
 *
 * Media entitlement refusals live in `src/resources/resources.spec.ts` — the suite's licence is
 * ADVANCED for every school on the box (see setup/global-setup.ts), so the refusal cannot be
 * arranged here.
 */
import { PrismaClient } from '@prisma/client';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetStorage } from '../src/common/storage';
import { Api, ownerDb, seededSchool, startApi } from './setup/harness';

const MB = 1024 * 1024;

describe('learning resources media', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  let storageDir: string;

  beforeAll(async () => {
    // A scratch storage root, so runs do not shed uploaded fixtures into the repo tree.
    storageDir = await mkdtemp(join(tmpdir(), 'eyo-resources-it-'));
    process.env.STORAGE_LOCAL_DIR = storageDir;
    resetStorage();

    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
    resetStorage();
    await rm(storageDir, { recursive: true, force: true });
  });

  async function uploadFile(name: string, type: string, bytes: Buffer) {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(bytes)], { type }), name);
    fd.append('title', `Integration upload ${name}`);
    const res = await fetch(`${api.baseUrl}/resources`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: fd,
    });
    const body = (await res.json().catch(() => null)) as {
      id?: string;
      mimeType?: string;
      sizeBytes?: number;
      message?: string;
    } | null;
    return { status: res.status, body };
  }

  it('accepts an audio file larger than the document cap', async () => {
    // 10MB: over the 8MB document cap on purpose — this passing is the whole feature.
    const bytes = Buffer.alloc(10 * MB, 0x61);
    const { status, body } = await uploadFile('listening-practice.mp3', 'audio/mpeg', bytes);
    expect(status).toBe(201);
    expect(body?.mimeType).toBe('audio/mpeg');
    expect(body?.sizeBytes).toBe(bytes.length);

    const row = await db.learningResource.findFirstOrThrow({ where: { id: body!.id } });
    expect(row.schoolId).toBe(schoolId);
    expect(row.mimeType).toBe('audio/mpeg');
  });

  it('accepts a video file and streams the same bytes back with its content type', async () => {
    const bytes = Buffer.alloc(9 * MB);
    // Not a constant fill: a truncated or reordered stream must not compare equal by luck.
    for (let i = 0; i < bytes.length; i += 4) bytes.writeUInt32LE(i % 0xffffffff, i);
    const { status, body } = await uploadFile('open-day.mp4', 'video/mp4', bytes);
    expect(status).toBe(201);

    const res = await fetch(`${api.baseUrl}/resources/${body!.id}/file`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('video/mp4');
    expect(Number(res.headers.get('content-length'))).toBe(bytes.length);
    expect(res.headers.get('content-disposition')).toContain('open-day.mp4');
    const returned = Buffer.from(await res.arrayBuffer());
    expect(returned.equals(bytes)).toBe(true);

    // The read was recorded — the staff catalog counts openings.
    const row = await db.learningResource.findFirstOrThrow({ where: { id: body!.id } });
    expect(row.downloads).toBe(1);
  });

  it('still refuses a document over the 8MB document cap', async () => {
    const { status, body } = await uploadFile(
      'scanned-notes.pdf',
      'application/pdf',
      Buffer.alloc(9 * MB),
    );
    expect(status).toBe(400);
    expect(body?.message).toContain('8MB');
  });

  it('still refuses a type on neither allow-list', async () => {
    const { status, body } = await uploadFile(
      'term-files.zip',
      'application/zip',
      Buffer.alloc(1024),
    );
    expect(status).toBe(400);
    expect(body?.message).toContain('Unsupported file type');
  });
});
