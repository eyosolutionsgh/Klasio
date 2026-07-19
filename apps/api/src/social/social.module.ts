/**
 * The school's social accounts: connecting them, and the one public route publishing needs.
 *
 * The service is next door in social.service.ts — see the note there for why.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Global,
  Module,
  NotFoundException,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { IsIn, IsString, MinLength } from 'class-validator';
import type { SocialPlatform } from '@prisma/client';
import {
  CurrentUser,
  Public,
  RequireEntitlement,
  RequirePermission,
  type AuthUser,
} from '../common/auth';
import { SocialService } from './social.service';

export { SocialService } from './social.service';

const PLATFORMS = ['FACEBOOK_PAGE', 'INSTAGRAM', 'X', 'TIKTOK'] as const;

class ConnectDto {
  @IsIn(PLATFORMS) platform: SocialPlatform;
  /**
   * A long-lived access token from the platform.
   *
   * Everything else about the account — its id, its name, its scopes, its expiry — is read back
   * from the platform rather than asked for here. A school should not have to know its own
   * numeric Instagram user id, and should not be able to mistype it.
   */
  @IsString() @MinLength(20) token: string;
}

@Controller('social')
export class SocialController {
  constructor(private svc: SocialService) {}

  @Get('platforms')
  platforms() {
    return this.svc.available();
  }

  @Get('accounts')
  @RequirePermission('comms.social')
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user.schoolId);
  }

  @Post('accounts')
  @RequirePermission('comms.social')
  @RequireEntitlement('comms.social')
  connect(@CurrentUser() user: AuthUser, @Body() dto: ConnectDto) {
    return this.svc.connect(user.schoolId, dto.platform, dto.token, user.sub);
  }

  @Delete('accounts/:id')
  @RequirePermission('comms.social')
  disconnect(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.disconnect(user.schoolId, id, user.sub);
  }
}

/**
 * The narrow exception to "every stored object is behind auth" (common/storage.ts).
 *
 * Instagram accepts only a publicly fetchable `image_url` — there is no binary upload — so the
 * bytes have to be reachable by Meta's servers for the few seconds the publish takes. The token is
 * minted immediately before, dies in fifteen minutes, and is revoked in the database as soon as
 * the publish returns.
 *
 * Kept in its own controller so it cannot be extended by accident. Do not reach for this pattern
 * from anything that serves student data: the objection there is to a long-lived, unrevocable
 * bearer token over child records, and none of the three properties that make this acceptable
 * — short, revoked, and a marketing image that is about to be public anyway — would hold.
 */
@Controller('public/broadcast-media')
export class PublicBroadcastMediaController {
  constructor(private svc: SocialService) {}

  @Public()
  @Get(':token')
  async media(@Param('token') token: string) {
    try {
      const { buf, mimeType } = await this.svc.readPublicMedia(token);
      return new StreamableFile(buf, { type: mimeType });
    } catch {
      // Deliberately indistinguishable from a token that never existed.
      throw new NotFoundException('Not found');
    }
  }
}

@Global()
@Module({
  controllers: [SocialController, PublicBroadcastMediaController],
  providers: [SocialService],
  exports: [SocialService],
})
export class SocialModule {}
