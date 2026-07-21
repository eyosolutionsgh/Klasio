/**
 * Upload gating: which files the library accepts, at what size, and on whose licence.
 *
 * These are the refusal paths only — they all throw before the service touches storage or the
 * database, so a stubbed constructor is honest here. The accept path (multipart in, bytes
 * streamed to storage, streamed back out) is proved against the real API in
 * `test/resources.int-spec.ts`.
 */
import { describe, expect, it } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ResourcesService } from './resources.module';
import type { AuthUser } from '../common/auth';
import type { PrismaService } from '../prisma/prisma.service';
import type { LicenceService } from '../licence/licence.service';

const MB = 1024 * 1024;

/** A service whose licence answers with exactly these codes. Nothing else is reachable. */
const service = (codes: string[]) =>
  new ResourcesService(
    {} as PrismaService,
    { entitlements: () => codes } as unknown as LicenceService,
  );

const auth = { sub: 'user-1', schoolId: 'school-1' } as AuthUser;

const upload = (
  svc: ResourcesService,
  file: { originalname: string; mimetype: string; size: number },
) =>
  svc.upload(
    auth,
    { title: 'A test file' },
    {
      // Points nowhere on purpose: every case below must refuse before the file would be read.
      path: '/nonexistent/upload.tmp',
      ...file,
    },
  );

describe('resource upload gating', () => {
  it('refuses video when the licence does not carry resources.media', async () => {
    await expect(
      upload(service(['resources.documents']), {
        originalname: 'lesson.mp4',
        mimetype: 'video/mp4',
        size: 20 * MB,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses audio when the licence does not carry resources.media', async () => {
    await expect(
      upload(service(['resources.documents']), {
        originalname: 'note.ogg',
        mimetype: 'audio/ogg',
        size: 2 * MB,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('holds documents to the 8MB cap even on a media-entitled licence', async () => {
    await expect(
      upload(service(['resources.documents', 'resources.media']), {
        originalname: 'past-questions.pdf',
        mimetype: 'application/pdf',
        size: 9 * MB,
      }),
    ).rejects.toThrow(/8MB/);
  });

  it('holds media to its own, higher cap', async () => {
    await expect(
      upload(service(['resources.documents', 'resources.media']), {
        originalname: 'open-day.mp4',
        mimetype: 'video/mp4',
        size: 513 * MB,
      }),
    ).rejects.toThrow(/512MB/);
  });

  it('still refuses types on neither allow-list, entitled or not', async () => {
    await expect(
      upload(service(['resources.documents', 'resources.media']), {
        originalname: 'archive.zip',
        mimetype: 'application/zip',
        size: 1 * MB,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
