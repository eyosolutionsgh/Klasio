import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { IsOptional, IsString, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireEntitlement, Roles } from '../common/auth';
import { DOCUMENT_TYPES, MAX_UPLOAD_BYTES, objectKey, storage } from '../common/storage';

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

/** Minimal shape of a Multer upload — avoids depending on @types/multer. */
interface UploadedFileLike {
  buffer: Buffer;
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
  constructor(private db: PrismaService) {}

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

  /** Staff see drafts as well as published files — they are the ones deciding what to release. */
  async list(
    auth: AuthUser,
    filters: { levelId?: string; classId?: string; subjectId?: string; published?: string },
  ) {
    const resources = await this.db.learningResource.findMany({
      where: {
        schoolId: auth.schoolId,
        ...(filters.levelId ? { levelId: filters.levelId } : {}),
        ...(filters.classId ? { classId: filters.classId } : {}),
        ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
        ...(filters.published === undefined ? {} : { published: filters.published === 'true' }),
      },
      include: this.relations,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return resources.map((r) => this.shape(r));
  }

  private assertUpload(file: UploadedFileLike | undefined) {
    if (!file?.buffer) throw new BadRequestException('No file uploaded');
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `File is too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB)`,
      );
    }
    if (!RESOURCE_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(`Unsupported file type ${file.mimetype}`);
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
    this.assertUpload(file);
    await this.assertTargets(auth, dto);

    // Grouped by what the file is for, since the resource id does not exist until the row does.
    const key = objectKey(
      auth.schoolId,
      'resources',
      dto.classId || dto.levelId || 'school',
      file.originalname,
    );
    await storage().put(key, file.buffer, file.mimetype);
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

    const buffer = await storage().get(resource.key);
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
    return { buffer, resource };
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
  list(
    @CurrentUser() user: AuthUser,
    @Query('levelId') levelId?: string,
    @Query('classId') classId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('published') published?: string,
  ) {
    return this.svc.list(user, { levelId, classId, subjectId, published });
  }

  @Post()
  @Roles('OWNER', 'HEAD', 'TEACHER')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: AuthUser,
    @Body() dto: UploadResourceDto,
    @UploadedFile() file: UploadedFileLike,
  ) {
    return this.svc.upload(user, dto, file);
  }

  @Get(':id/file')
  async file(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { buffer, resource } = await this.svc.download(user.schoolId, id, { userId: user.sub });
    return new StreamableFile(buffer, {
      type: resource.mimeType,
      disposition: `attachment; filename="${resource.filename.replace(/"/g, '')}"`,
    });
  }

  @Get(':id/downloads')
  @Roles('OWNER', 'HEAD', 'TEACHER')
  downloads(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.downloadLog(user, id);
  }

  @Post(':id/publish')
  @Roles('OWNER', 'HEAD', 'TEACHER')
  publish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.setPublished(user, id, true);
  }

  @Post(':id/unpublish')
  @Roles('OWNER', 'HEAD', 'TEACHER')
  unpublish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.setPublished(user, id, false);
  }

  @Delete(':id')
  @Roles('OWNER', 'HEAD', 'TEACHER')
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
