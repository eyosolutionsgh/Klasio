import { Body, Controller, Get, Injectable, Module, Post } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/auth';

class CreateAnnouncementDto {
  @IsString() @MinLength(3) title: string;
  @IsString() @MinLength(3) body: string;
}

@Injectable()
export class AnnouncementsService {
  constructor(private db: PrismaService) {}

  list(auth: AuthUser) {
    return this.db.announcement.findMany({
      where: { schoolId: auth.schoolId },
      orderBy: { publishedAt: 'desc' },
      take: 50,
    });
  }

  async create(auth: AuthUser, dto: CreateAnnouncementDto) {
    const a = await this.db.announcement.create({
      data: { schoolId: auth.schoolId, title: dto.title, body: dto.body, createdById: auth.sub },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'announcement.create', 'Announcement', a.id);
    return a;
  }
}

@Controller('announcements')
export class AnnouncementsController {
  constructor(private svc: AnnouncementsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user);
  }

  @Post()
  @RequirePermission('comms.announce')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAnnouncementDto) {
    return this.svc.create(user, dto);
  }
}

@Module({ controllers: [AnnouncementsController], providers: [AnnouncementsService] })
export class AnnouncementsModule {}
