/**
 * Connecting a school's social accounts, and publishing to them.
 *
 * Split from social.module.ts for the same reason LicenceService is: BroadcastsModule needs this
 * service, and threading it back through the controller's decorators risks the import cycle that
 * cost an afternoon once already.
 *
 * ## Why token paste, and not OAuth
 *
 * Meta requires an HTTPS redirect URI registered in the app. One school per server means there is
 * no single URI to register, and a vendor-hosted OAuth relay would rebuild exactly the vendor
 * plane this product just deleted. So the primary path is: the school pastes a long-lived token,
 * and the *server* does the work they would get wrong — enumerating Pages, deriving the linked
 * Instagram account, and reading the real expiry from `debug_token`. One paste connects both Meta
 * surfaces, works on a box with no public hostname, and needs no vendor infrastructure.
 *
 * A school with its own domain and its own Meta app can still do real OAuth; that path is opt-in
 * and is not what most schools will use.
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { SocialPlatform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret, publicToken } from '../common/crypto';
import { storage } from '../common/storage';
import {
  FacebookPageProvider,
  InstagramProvider,
  MockSocialProvider,
  TikTokProvider,
  XProvider,
  type PublishMedia,
  type SocialProvider,
} from './providers';

/** How long a broadcast image stays publicly fetchable. Long enough for Meta, short enough to
 *  be useless to anyone who scrapes the URL out of a log. */
const MEDIA_TOKEN_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class SocialService {
  private readonly log = new Logger('Social');
  private readonly providers = new Map<SocialPlatform, SocialProvider>();

  constructor(private db: PrismaService) {
    const mock = process.env.ALLOW_MOCK_SOCIAL === 'true';
    if (mock) {
      // Same escape hatch as ALLOW_MOCK_SMS, and the same warning: a mock reports success and
      // reaches nobody. Fine for CI, a lie in production.
      this.log.warn('ALLOW_MOCK_SOCIAL is set — nothing will actually be posted anywhere.');
      for (const p of ['FACEBOOK_PAGE', 'INSTAGRAM', 'X', 'TIKTOK'] as SocialPlatform[]) {
        this.providers.set(p, new MockSocialProvider(p));
      }
    } else {
      this.providers.set('FACEBOOK_PAGE', new FacebookPageProvider());
      this.providers.set('INSTAGRAM', new InstagramProvider());
      this.providers.set('X', new XProvider());
      this.providers.set('TIKTOK', new TikTokProvider());
    }
  }

  private provider(platform: SocialPlatform): SocialProvider {
    const p = this.providers.get(platform);
    if (!p) throw new BadRequestException(`${platform} is not supported by this deployment`);
    return p;
  }

  /** Which platforms the connect screen should offer. */
  available() {
    return [
      { platform: 'FACEBOOK_PAGE', label: 'Facebook Page', enabled: true },
      { platform: 'INSTAGRAM', label: 'Instagram', enabled: true },
      {
        platform: 'X',
        label: 'X',
        enabled: process.env.SOCIAL_X_ENABLED === 'true',
        note: 'Needs a paid X API tier',
      },
      {
        platform: 'TIKTOK',
        label: 'TikTok',
        enabled: process.env.SOCIAL_TIKTOK_ENABLED === 'true',
        note: 'Needs an audited TikTok app',
      },
    ];
  }

  /** Connected accounts. Never returns a token — only whether one is held, as GatewayAccount does. */
  async list(schoolId: string) {
    const rows = await this.db.socialAccount.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((a) => ({
      id: a.id,
      platform: a.platform,
      externalId: a.externalId,
      displayName: a.displayName,
      status: a.status,
      active: a.active,
      hasToken: !!a.accessTokenEnc,
      tokenExpiresAt: a.tokenExpiresAt,
      lastCheckedAt: a.lastCheckedAt,
    }));
  }

  /**
   * Connect by pasting a token.
   *
   * Everything stored about the account comes from the platform's own answer, not from the form:
   * the id, the display name, the scopes and the expiry. A school that pastes the wrong token
   * gets told whose Page it actually is rather than having their answer recorded as fact.
   */
  async connect(schoolId: string, platform: SocialPlatform, token: string, userId: string) {
    const provider = this.provider(platform);
    let verified;
    try {
      verified = await provider.verify(token.trim());
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'That token was not accepted');
    }

    const connected: string[] = [];
    const save = async (p: SocialPlatform, externalId: string, displayName: string) => {
      const data = {
        displayName,
        // requireReal: a live social token is a credential that can post in the school's name to
        // the public. Storing it under the deterministic dev key would be worse than not storing it.
        accessTokenEnc: encryptSecret(token.trim(), true),
        scopes: verified.scopes,
        tokenExpiresAt: verified.expiresAt ?? null,
        status: 'ACTIVE',
        active: true,
        connectedById: userId,
        lastCheckedAt: new Date(),
      };
      await this.db.socialAccount.upsert({
        where: { schoolId_platform_externalId: { schoolId, platform: p, externalId } },
        create: { schoolId, platform: p, externalId, ...data },
        update: data,
      });
      connected.push(`${p}: ${displayName}`);
    };

    await save(platform, verified.externalId, verified.displayName);
    // One paste, both Meta surfaces — the Instagram account is discovered from the Page rather
    // than asked for, because a school should not have to know it has a numeric IG user id.
    if (platform === 'FACEBOOK_PAGE' && verified.alsoInstagram) {
      await save(
        'INSTAGRAM',
        verified.alsoInstagram.externalId,
        verified.alsoInstagram.displayName,
      );
    }

    await this.db.audit(schoolId, userId, 'social.connect', 'SocialAccount', verified.externalId, {
      platform,
      connected,
    });
    return { connected };
  }

  async disconnect(schoolId: string, id: string, userId: string) {
    const acc = await this.db.socialAccount.findFirst({ where: { id, schoolId } });
    if (!acc) throw new NotFoundException('That account is not connected');
    await this.db.socialAccount.delete({ where: { id } });
    await this.db.audit(schoolId, userId, 'social.disconnect', 'SocialAccount', id, {
      platform: acc.platform,
    });
    return { ok: true };
  }

  /**
   * Publish one broadcast to every connected account.
   *
   * Called inside the request today. When Redis is present this is the natural thing to move onto
   * BullMQ — and whoever does must remember that a worker has no request context, so
   * `app_current_school()` is NULL and every RLS policy matches nothing. Enumerate with
   * `db.system`, then wrap the per-school work in `withTenant`. That trap has silently disabled a
   * shipped feature in this codebase once already; see the note at the top of RemindersQueue.
   */
  async publishBroadcast(schoolId: string, broadcastId: string) {
    const accounts = await this.db.socialAccount.findMany({
      where: { schoolId, active: true, status: { not: 'REVOKED' } },
    });
    if (accounts.length === 0) throw new BadRequestException('No social accounts are connected');

    const broadcast = await this.db.broadcast.findFirstOrThrow({
      where: { id: broadcastId, schoolId },
      include: { media: { orderBy: { order: 'asc' } } },
    });
    const text = `${broadcast.title}\n\n${broadcast.body}`;

    let published = 0;
    const notes: string[] = [];

    for (const acc of accounts) {
      const provider = this.provider(acc.platform);

      // Checked before anything is queued, so the answer is "Instagram needs a picture" rather
      // than a Graph error nobody outside Meta can read.
      if (provider.requiresMedia && broadcast.media.length === 0) {
        await this.recordPost(schoolId, broadcastId, acc, {
          ok: false,
          error: `${acc.platform} cannot post without an image`,
        });
        notes.push(`${acc.platform}: needs an image`);
        continue;
      }

      const media = await this.loadMedia(broadcast.media, acc.platform);
      let result;
      try {
        result = await provider.publish(decryptSecret(acc.accessTokenEnc), acc.externalId, {
          text,
          media,
        });
      } catch (e) {
        result = { ok: false, error: e instanceof Error ? e.message : String(e) };
      } finally {
        // Revoked in the same pass that used them, whether or not the publish worked. A token that
        // outlives its publish is the thing the no-public-URLs rule exists to prevent.
        await this.revokeMediaTokens(broadcast.media.map((m) => m.id));
      }

      await this.recordPost(schoolId, broadcastId, acc, result);
      if (result.ok) published++;
      notes.push(`${acc.platform}: ${result.ok ? 'posted' : (result.error ?? 'failed')}`);
    }

    return { published, total: accounts.length, detail: notes.join('; ') };
  }

  /**
   * Load the bytes, and mint a public URL only for the platform that cannot take bytes.
   *
   * Facebook accepts a binary upload, so it never gets a URL. Instagram accepts only `image_url`
   * and offers no alternative, which is the entire reason the exception exists.
   */
  private async loadMedia(
    media: { id: string; key: string; mimeType: string; filename: string }[],
    platform: SocialPlatform,
  ): Promise<PublishMedia[]> {
    const base = process.env.PUBLIC_BASE_URL ?? '';
    const out: PublishMedia[] = [];
    for (const m of media) {
      const buffer = await storage().get(m.key);
      let url: string | undefined;
      if (platform === 'INSTAGRAM') {
        const token = publicToken(24);
        await this.db.broadcastMedia.update({
          where: { id: m.id },
          data: {
            publicToken: token,
            publicTokenExpiresAt: new Date(Date.now() + MEDIA_TOKEN_TTL_MS),
          },
        });
        url = `${base}/api/public/broadcast-media/${token}`;
      }
      out.push({ buffer, mimeType: m.mimeType, filename: m.filename, publicUrl: url });
    }
    return out;
  }

  private async revokeMediaTokens(ids: string[]) {
    if (ids.length === 0) return;
    await this.db.broadcastMedia.updateMany({
      where: { id: { in: ids } },
      data: { publicToken: null, publicTokenExpiresAt: null },
    });
  }

  private async recordPost(
    schoolId: string,
    broadcastId: string,
    acc: { id: string; platform: SocialPlatform },
    result: { ok: boolean; externalId?: string; permalink?: string; error?: string },
  ) {
    const data = {
      status: result.ok ? 'PUBLISHED' : 'FAILED',
      externalId: result.externalId ?? null,
      permalink: result.permalink ?? null,
      error: result.error ?? null,
      publishedAt: result.ok ? new Date() : null,
    };
    await this.db.socialPost.upsert({
      // Enqueueing the same broadcast twice must not post twice.
      where: { broadcastId_accountId: { broadcastId, accountId: acc.id } },
      create: {
        schoolId,
        broadcastId,
        accountId: acc.id,
        platform: acc.platform,
        attempts: 1,
        ...data,
      },
      update: { attempts: { increment: 1 }, ...data },
    });
  }

  /** Bytes for a minted token, or nothing. Used by the unauthenticated media route. */
  async readPublicMedia(token: string) {
    const m = await this.db.system.broadcastMedia.findUnique({ where: { publicToken: token } });
    if (!m || !m.publicTokenExpiresAt || m.publicTokenExpiresAt.getTime() < Date.now()) {
      throw new NotFoundException('Not found');
    }
    return { buf: await storage().get(m.key), mimeType: m.mimeType };
  }
}
