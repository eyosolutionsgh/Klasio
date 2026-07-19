/**
 * Licence installation and enforcement.
 *
 * The vendor console is gone: nothing reaches into this box to set a tier. What the school has
 * paid for is stated in a signed file, and this module reads it, checks it, and keeps
 * `School.tier` in step with it. The service itself is next door in licence.service.ts — see the
 * note there for why it had to move out of this file.
 */
import { Body, Controller, Get, Global, Module, Post } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { CurrentUser, RequirePermission, type AuthUser } from '../common/auth';
import { LicenceService } from './licence.service';

export { LicenceService } from './licence.service';

class InstallLicenceDto {
  /** The licence text, as issued. Pasted into the settings screen or read from a file. */
  @IsString()
  @MinLength(16)
  licence!: string;
}

@Controller('licence')
export class LicenceController {
  constructor(private svc: LicenceService) {}

  /**
   * Readable by any signed-in member of staff. Whether the school's licence is about to lapse is
   * not privileged information — the people who would have to chase it are the ones who need to
   * see it, and hiding it behind the owner's account is how a renewal gets missed.
   */
  @Get()
  view() {
    return this.svc.view();
  }

  @Post()
  @RequirePermission('school.settings')
  install(@Body() dto: InstallLicenceDto, @CurrentUser() auth: AuthUser) {
    return this.svc.install(dto.licence, auth);
  }
}

/**
 * Global, like PrismaModule: what a school is entitled to is asked from three unrelated places
 * (the /me payload, enrolment headroom in two modules), and threading an import through each of
 * them would say those modules depend on licensing when they depend on one number.
 */
@Global()
@Module({
  controllers: [LicenceController],
  providers: [LicenceService],
  exports: [LicenceService],
})
export class LicenceModule {}
