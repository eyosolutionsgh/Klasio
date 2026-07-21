import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import type { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireEntitlement, RequirePermission } from '../common/auth';
import { LicenceService } from '../licence/licence.service';
import {
  DOCUMENT_TYPES,
  MAX_MEDIA_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  MEDIA_TYPES,
  objectKey,
  storage,
} from '../common/storage';
import { PageQuery, dateWindow, orderBy, pageArgs, toPage } from '../common/list-query';

/**
 * Which columns the library may be sorted by, and what each maps to in Prisma.
 *
 * An allowlist rather than a passthrough — `sort` arrives on a query string and is spread into
 * `orderBy`, so an unchecked value would let a caller order by a relation this endpoint never
 * meant to reach through. There is no single "For" column to sort on: a file is tagged to a class,
 * a level and a subject independently, so each is offered on its own rather than by whichever the
 * database happened to hold.
 */
const RESOURCE_SORTS: Record<string, string | string[]> = {
  title: 'title',
  subjectName: 'subject.name',
  levelName: 'level.name',
  className: 'classRoom.name',
  downloads: 'downloads',
  sizeBytes: 'sizeBytes',
  published: 'published',
  createdAt: 'createdAt',
};

/**
 * The library's filters. Extends the shared paging/sorting/date-window base; `from`/`to` filter
 * the upload date (see `list`).
 */
class ListResourcesDto extends PageQuery {
  @IsOptional() @IsString() levelId?: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() subjectId?: string;
  /**
   * Stays a string rather than becoming a boolean: three states, not two. Absent means "both
   * drafts and published", which a boolean cannot express without an extra flag beside it.
   */
  @IsOptional() @IsIn(['true', 'false']) published?: string;
  @IsOptional() @IsString() q?: string;
}

/**
 * Wider than the student-document list: lesson notes arrive as Word and PowerPoint far more
 * often than as PDF, and past questions are frequently plain text. Still an allow-list — this
 * is an authenticated upload endpoint, not a file share.
 */
const RESOURCE_TYPES = [
  ...DOCUMENT_TYPES,
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

/**
 * Minimal shape of a Multer upload — avoids depending on @types/multer.
 *
 * `path`, not `buffer`: this endpoint uses Multer's disk storage, because a lesson video at
 * the media cap held in memory would be a fine way to take a school's whole box down. The
 * temp file is streamed into object storage and removed in `upload`'s finally.
 */
interface UploadedFileLike {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * Multipart fields arrive as strings, so this carries no booleans — publishing is its own
 * explicit endpoint rather than a checkbox smuggled through the upload form.
 */
class UploadResourceDto {
  @IsString() @MinLength(3) title: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() subjectId?: string;
  @IsOptional() @IsString() levelId?: string;
  @IsOptional() @IsString() classId?: string;
}

/** Which classes and levels a family or pupil belongs to — the whole of their visibility. */
export interface ResourceScope {
  levelIds: string[];
  classIds: string[];
}

@Injectable()
export class ResourcesService {
  constructor(
    private db: PrismaService,
    private licence: LicenceService,
  ) {}

  private shape(r: {
    id: string;
    title: string;
    description: string | null;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    published: boolean;
    downloads: number;
    createdAt: Date;
    subject?: { name: string } | null;
    level?: { name: string } | null;
    classRoom?: { name: string } | null;
    subjectId: string | null;
    levelId: string | null;
    classId: string | null;
  }) {
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      filename: r.filename,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      published: r.published,
      downloads: r.downloads,
      createdAt: r.createdAt,
      subjectId: r.subjectId,
      levelId: r.levelId,
      classId: r.classId,
      subjectName: r.subject?.name ?? null,
      levelName: r.level?.name ?? null,
      className: r.classRoom?.name ?? null,
    };
  }

  private readonly relations = {
    subject: { select: { name: true } },
    level: { select: { name: true } },
    classRoom: { select: { name: true } },
  };

  /**
   * The library, paged. Staff see drafts as well as published files — they are the ones deciding
   * what to release.
   *
   * This used to return a bare array capped at `take: 200`. A school two years into using the
   * library saw the most recent 200 files and nothing said the older ones existed, so a teacher
   * looking for last year's past questions concluded they had never been uploaded.
   */
  async list(auth: AuthUser, q: ListResourcesDto) {
    const { skip, take, page, perPage } = pageArgs(q);
    const uploaded = dateWindow(q);
    const where = {
      schoolId: auth.schoolId,
      ...(q.levelId ? { levelId: q.levelId } : {}),
      ...(q.classId ? { classId: q.classId } : {}),
      ...(q.subjectId ? { subjectId: q.subjectId } : {}),
      ...(q.published === undefined ? {} : { published: q.published === 'true' }),
      // The window filters when the file was uploaded — "everything shared since half term" is
      // the question a head asks of a library, and it is the only date these rows carry.
      ...(uploaded ? { createdAt: uploaded } : {}),
      // The filename as well as the title: a teacher hunting for a scan generally remembers what
      // the file was called long before they remember how somebody else titled it.
      ...(q.q
        ? {
            OR: [
              { title: { contains: q.q, mode: 'insensitive' as const } },
              { filename: { contains: q.q, mode: 'insensitive' as const } },
              { description: { contains: q.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, resources] = await Promise.all([
      this.db.learningResource.count({ where }),
      this.db.learningResource.findMany({
        where,
        include: this.relations,
        orderBy: orderBy<Prisma.LearningResourceOrderByWithRelationInput>(q, RESOURCE_SORTS, {
          createdAt: 'desc',
        }),
        skip,
        take,
      }),
    ]);
    return toPage(
      resources.map((r) => this.shape(r)),
      total,
      { page, perPage },
    );
  }

  private assertUpload(file: UploadedFileLike | undefined) {
    if (!file?.path) throw new BadRequestException('No file uploaded');
    const isMedia = MEDIA_TYPES.includes(file.mimetype);
    if (!isMedia && !RESOURCE_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(`Unsupported file type ${file.mimetype}`);
    }
    /**
     * Asked of the licence, not the tier, for the same reason the guard is (common/auth.ts):
     * `resources.media` is exactly the kind of single Advanced code a licence can grant a
     * Medium school on top of its bundle.
     */
    if (isMedia && !this.licence.entitlements().includes('resources.media')) {
      throw new ForbiddenException(
        "Video and audio files are not included in your school's package",
      );
    }
    // Media gets its own, far higher cap — a recorded lesson does not fit in 8MB, and it is
    // streamed to storage rather than buffered, so the memory argument for 8MB does not apply.
    const cap = isMedia ? MAX_MEDIA_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
    if (file.size > cap) {
      throw new BadRequestException(
        `File is too large (max ${Math.round(cap / 1024 / 1024)}MB for ${
          isMedia ? 'video and audio' : 'documents'
        })`,
      );
    }
  }

  /** Every target has to belong to the caller's school, or the tag is a cross-tenant reference. */
  private async assertTargets(auth: AuthUser, dto: UploadResourceDto) {
    if (dto.subjectId) {
      const subject = await this.db.subject.findFirst({
        where: { id: dto.subjectId, schoolId: auth.schoolId },
      });
      if (!subject) throw new NotFoundException('That subject does not exist');
    }
    if (dto.levelId) {
      const level = await this.db.level.findFirst({
        where: { id: dto.levelId, schoolId: auth.schoolId },
      });
      if (!level) throw new NotFoundException('That level does not exist');
    }
    if (dto.classId) {
      const classRoom = await this.db.classRoom.findFirst({
        where: { id: dto.classId, schoolId: auth.schoolId },
      });
      if (!classRoom) throw new NotFoundException('That class does not exist');
    }
  }

  /**
   * Uploads land as drafts. A teacher scanning last year's paper should be able to fix the title
   * or realise it is the wrong file before any parent sees it.
   */
  async upload(auth: AuthUser, dto: UploadResourceDto, file: UploadedFileLike) {
    try {
      return await this.doUpload(auth, dto, file);
    } finally {
      // Multer wrote the temp file before we ever ran, so it is cleaned up whether the upload
      // was stored, refused, or fell over.
      if (file?.path) await rm(file.path, { force: true });
    }
  }

  private async doUpload(auth: AuthUser, dto: UploadResourceDto, file: UploadedFileLike) {
    this.assertUpload(file);
    await this.assertTargets(auth, dto);

    // Grouped by what the file is for, since the resource id does not exist until the row does.
    const key = objectKey(
      auth.schoolId,
      'resources',
      dto.classId || dto.levelId || 'school',
      file.originalname,
    );
    await storage().putFile(key, file.path, file.mimetype, file.size);
    const resource = await this.db.learningResource.create({
      data: {
        schoolId: auth.schoolId,
        title: dto.title,
        description: dto.description,
        key,
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        subjectId: dto.subjectId || null,
        levelId: dto.levelId || null,
        classId: dto.classId || null,
        uploadedById: auth.sub,
      },
      include: this.relations,
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'resource.upload',
      'LearningResource',
      resource.id,
      { filename: file.originalname },
    );
    return this.shape(resource);
  }

  async setPublished(auth: AuthUser, id: string, published: boolean) {
    const existing = await this.db.learningResource.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!existing) throw new NotFoundException('Resource not found');
    const resource = await this.db.learningResource.update({
      where: { id },
      data: { published },
      include: this.relations,
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      published ? 'resource.publish' : 'resource.unpublish',
      'LearningResource',
      id,
      { title: resource.title },
    );
    return this.shape(resource);
  }

  async remove(auth: AuthUser, id: string) {
    const resource = await this.db.learningResource.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!resource) throw new NotFoundException('Resource not found');
    await storage()
      .delete(resource.key)
      .catch(() => undefined);
    // ResourceDownload rows cascade with the resource.
    await this.db.learningResource.delete({ where: { id } });
    await this.db.audit(auth.schoolId, auth.sub, 'resource.delete', 'LearningResource', id, {
      title: resource.title,
    });
    return { deleted: true };
  }

  /**
   * The published shelf for one family or pupil.
   *
   * A resource tagged to a class is for that class; one tagged only to a level is for the whole
   * level; one tagged to neither is for the whole school. Both tags are ANDed rather than ORed,
   * so a mis-tagged file leaks narrower, not wider.
   */
  async feed(schoolId: string, scope: ResourceScope, subjectId?: string) {
    const resources = await this.db.learningResource.findMany({
      where: {
        schoolId,
        published: true,
        ...(subjectId ? { subjectId } : {}),
        AND: [
          { OR: [{ levelId: null }, { levelId: { in: scope.levelIds } }] },
          { OR: [{ classId: null }, { classId: { in: scope.classIds } }] },
        ],
      },
      include: this.relations,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return resources.map((r) => this.shape(r));
  }

  /**
   * Bytes always come through here, never a public URL, so the caller's school and — for a
   * family — their class scope is checked on every single read. `scope` omitted means staff,
   * who may also fetch a draft.
   */
  async download(
    schoolId: string,
    id: string,
    who: { userId?: string; guardianId?: string; studentId?: string },
    scope?: ResourceScope,
  ) {
    const resource = await this.db.learningResource.findFirst({
      where: {
        id,
        schoolId,
        ...(scope
          ? {
              published: true,
              AND: [
                { OR: [{ levelId: null }, { levelId: { in: scope.levelIds } }] },
                { OR: [{ classId: null }, { classId: { in: scope.classIds } }] },
              ],
            }
          : {}),
      },
    });
    if (!resource) throw new NotFoundException('Resource not found');

    // A stream, not a buffer: a video at the media cap must not transit the heap per reader.
    const stream = await storage().getStream(resource.key);
    // The catalog asks who opened what, and the counter is what the staff list shows.
    await this.db.resourceDownload.create({
      data: {
        schoolId,
        resourceId: resource.id,
        userId: who.userId ?? null,
        guardianId: who.guardianId ?? null,
        studentId: who.studentId ?? null,
      },
    });
    await this.db.learningResource.update({
      where: { id: resource.id },
      data: { downloads: { increment: 1 } },
    });
    return { stream, resource };
  }

  /** The StreamableFile every download route answers with — one shape for staff and portals. */
  static asFile({
    stream,
    resource,
  }: {
    stream: Readable;
    resource: { mimeType: string; filename: string; sizeBytes: number };
  }): StreamableFile {
    return new StreamableFile(stream, {
      type: resource.mimeType,
      length: resource.sizeBytes,
      disposition: `attachment; filename="${resource.filename.replace(/"/g, '')}"`,
    });
  }

  /** Who has opened one resource — the staff-side view of the download log. */
  async downloadLog(auth: AuthUser, id: string) {
    const resource = await this.db.learningResource.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!resource) throw new NotFoundException('Resource not found');
    const rows = await this.db.resourceDownload.findMany({
      where: { schoolId: auth.schoolId, resourceId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      by: r.userId ? 'STAFF' : r.guardianId ? 'GUARDIAN' : r.studentId ? 'STUDENT' : 'UNKNOWN',
      createdAt: r.createdAt,
    }));
  }
}

@Controller('resources')
@RequireEntitlement('resources.documents')
export class ResourcesController {
  constructor(private svc: ResourcesService) {}

  @Get()
  @RequirePermission('resources.view')
  list(@CurrentUser() user: AuthUser, @Query() query: ListResourcesDto) {
    return this.svc.list(user, query);
  }

  @Post()
  @RequirePermission('resources.manage')
  /**
   * Disk storage, not Multer's in-memory default: media uploads run to hundreds of megabytes.
   * The `fileSize` limit is the outermost backstop — Multer aborts the request at the media cap
   * (413) while the bytes are still arriving; the per-type caps are `assertUpload`'s job.
   */
  @UseInterceptors(
    FileInterceptor('file', { dest: tmpdir(), limits: { fileSize: MAX_MEDIA_UPLOAD_BYTES } }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @Body() dto: UploadResourceDto,
    @UploadedFile() file: UploadedFileLike,
  ) {
    return this.svc.upload(user, dto, file);
  }

  @Get(':id/file')
  @RequirePermission('resources.view')
  async file(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return ResourcesService.asFile(
      await this.svc.download(user.schoolId, id, { userId: user.sub }),
    );
  }

  @Get(':id/downloads')
  @RequirePermission('resources.manage')
  downloads(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.downloadLog(user, id);
  }

  @Post(':id/publish')
  @RequirePermission('resources.manage')
  publish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.setPublished(user, id, true);
  }

  @Post(':id/unpublish')
  @RequirePermission('resources.manage')
  unpublish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.setPublished(user, id, false);
  }

  @Delete(':id')
  @RequirePermission('resources.manage')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}

@Module({
  controllers: [ResourcesController],
  providers: [ResourcesService],
  exports: [ResourcesService],
})
export class ResourcesModule {}
