/**
 * Social publishing adapters, one per platform, behind one interface.
 *
 * Same shape as `SmsProvider` and `EmailProvider`: a named thing with a `publish` that returns
 * `{ ok, externalId?, error? }` and never throws for an ordinary refusal. The mock follows the
 * `ALLOW_MOCK_SMS` precedent and for the same reason — a mock that silently reports success would
 * tell a school its notice went out to two thousand followers when it reached nobody.
 */
import { Logger } from '@nestjs/common';
import type { SocialPlatform } from '@prisma/client';
import { asResponse } from '../common/http';

const GRAPH = 'https://graph.facebook.com/v21.0';

export interface PublishMedia {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  /** A short-lived public URL, minted only for platforms that cannot take bytes. */
  publicUrl?: string;
}

export interface PublishInput {
  text: string;
  media: PublishMedia[];
}

export interface PublishResult {
  ok: boolean;
  externalId?: string;
  permalink?: string;
  error?: string;
}

export interface VerifiedAccount {
  externalId: string;
  displayName: string;
  scopes: string[];
  expiresAt?: Date;
  /** Instagram rides on a Facebook Page, so verifying one can discover the other. */
  alsoInstagram?: { externalId: string; displayName: string };
}

export interface SocialProvider {
  readonly platform: SocialPlatform;
  readonly name: string;
  /**
   * Whether a text-only post is impossible. Checked before we queue rather than discovered from a
   * Graph error, so the composer can say "Instagram needs a picture" while the message is still
   * being written.
   */
  readonly requiresMedia: boolean;
  /** Confirm a token and ask the platform who it belongs to. Never trusts what the user typed. */
  verify(token: string): Promise<VerifiedAccount>;
  publish(token: string, externalId: string, input: PublishInput): Promise<PublishResult>;
}

async function graph(path: string, params: Record<string, string>, method: 'GET' | 'POST' = 'GET') {
  const url = new URL(`${GRAPH}${path}`);
  if (method === 'GET') for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = asResponse(
    await fetch(url, {
      method,
      ...(method === 'POST' ? { body: new URLSearchParams(params) } : {}),
    }),
  );
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = json.error as { message?: string } | undefined;
    // Graph's own message is far more useful than the status — "(#200) Requires
    // pages_manage_posts" tells you exactly which App Review item is missing.
    throw new Error(err?.message ?? `Graph API returned ${res.status}`);
  }
  return json;
}

export class FacebookPageProvider implements SocialProvider {
  readonly platform = 'FACEBOOK_PAGE' as const;
  readonly name = 'facebook';
  readonly requiresMedia = false;

  async verify(token: string): Promise<VerifiedAccount> {
    // The Page list, not /me: a user token names a person, and what we need is the Page they
    // administer. This also fails loudly and early when the token is a plain user token.
    const accounts = (await graph('/me/accounts', {
      access_token: token,
      fields: 'id,name,access_token,tasks',
    })) as { data?: { id: string; name: string; access_token?: string; tasks?: string[] }[] };

    const page = accounts.data?.[0];
    if (!page) {
      throw new Error(
        'That token does not administer any Facebook Page. Use a Page access token, or a user token for an account that manages the school Page.',
      );
    }

    // Instagram Business accounts hang off a Page, so one paste connects both.
    let alsoInstagram: VerifiedAccount['alsoInstagram'];
    try {
      const ig = (await graph(`/${page.id}`, {
        access_token: page.access_token ?? token,
        fields: 'instagram_business_account{id,username}',
      })) as { instagram_business_account?: { id: string; username: string } };
      if (ig.instagram_business_account) {
        alsoInstagram = {
          externalId: ig.instagram_business_account.id,
          displayName: `@${ig.instagram_business_account.username}`,
        };
      }
    } catch {
      // A Page with no linked Instagram is the common case, not an error.
    }

    let expiresAt: Date | undefined;
    try {
      const dbg = (await graph('/debug_token', {
        input_token: page.access_token ?? token,
        access_token: token,
      })) as { data?: { expires_at?: number; scopes?: string[] } };
      // 0 means "never" for a Page token derived from a long-lived user token.
      if (dbg.data?.expires_at) expiresAt = new Date(dbg.data.expires_at * 1000);
      return {
        externalId: page.id,
        displayName: page.name,
        scopes: dbg.data?.scopes ?? [],
        expiresAt,
        alsoInstagram,
      };
    } catch {
      return { externalId: page.id, displayName: page.name, scopes: [], alsoInstagram };
    }
  }

  async publish(token: string, pageId: string, input: PublishInput): Promise<PublishResult> {
    try {
      if (input.media.length === 0) {
        const r = (await graph(
          `/${pageId}/feed`,
          { message: input.text, access_token: token },
          'POST',
        )) as { id?: string };
        return {
          ok: true,
          externalId: r.id,
          permalink: r.id ? `https://facebook.com/${r.id}` : undefined,
        };
      }

      // Graph takes the bytes directly, so no public URL is minted for Facebook — only Instagram
      // forces that, and only because it has no binary option at all.
      const form = new FormData();
      form.set('access_token', token);
      form.set('caption', input.text);
      form.set(
        'source',
        new Blob([new Uint8Array(input.media[0].buffer)], { type: input.media[0].mimeType }),
        input.media[0].filename,
      );
      const res = asResponse(
        await fetch(`${GRAPH}/${pageId}/photos`, { method: 'POST', body: form }),
      );
      const json = (await res.json().catch(() => ({}))) as {
        id?: string;
        post_id?: string;
        error?: { message?: string };
      };
      if (!res.ok)
        return { ok: false, error: json.error?.message ?? `Graph returned ${res.status}` };
      const id = json.post_id ?? json.id;
      return { ok: true, externalId: id, permalink: id ? `https://facebook.com/${id}` : undefined };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

export class InstagramProvider implements SocialProvider {
  readonly platform = 'INSTAGRAM' as const;
  readonly name = 'instagram';
  /** No text-only posts exist on Instagram. Refused here rather than by a Graph error. */
  readonly requiresMedia = true;

  async verify(token: string): Promise<VerifiedAccount> {
    const fb = new FacebookPageProvider();
    const page = await fb.verify(token);
    if (!page.alsoInstagram) {
      throw new Error(
        'No Instagram Business account is linked to that Facebook Page. Link it in Meta Business Suite, then connect again.',
      );
    }
    return {
      externalId: page.alsoInstagram.externalId,
      displayName: page.alsoInstagram.displayName,
      scopes: page.scopes,
      expiresAt: page.expiresAt,
    };
  }

  /**
   * Two steps, and the wait between them is not optional.
   *
   * Instagram builds the container asynchronously: publishing a creation_id that is still IN
   * PROGRESS fails, and the failure looks like a permissions error rather than a timing one.
   */
  async publish(token: string, igUserId: string, input: PublishInput): Promise<PublishResult> {
    try {
      const image = input.media[0];
      if (!image?.publicUrl) {
        return { ok: false, error: 'Instagram needs an image, and a reachable URL for it' };
      }

      const created = (await graph(
        `/${igUserId}/media`,
        { image_url: image.publicUrl, caption: input.text, access_token: token },
        'POST',
      )) as { id?: string };
      if (!created.id) return { ok: false, error: 'Instagram did not return a container id' };

      for (let attempt = 0; attempt < 10; attempt++) {
        const status = (await graph(`/${created.id}`, {
          fields: 'status_code',
          access_token: token,
        })) as { status_code?: string };
        if (status.status_code === 'FINISHED') break;
        if (status.status_code === 'ERROR') {
          return { ok: false, error: 'Instagram could not process that image' };
        }
        await new Promise((r) => setTimeout(r, 2000));
      }

      const published = (await graph(
        `/${igUserId}/media_publish`,
        { creation_id: created.id, access_token: token },
        'POST',
      )) as { id?: string };
      return { ok: true, externalId: published.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

/**
 * X and TikTok, wired but not connected.
 *
 * Both are blocked on something money or time buys rather than code: X's posting endpoints need a
 * paid API tier, and TikTok's Content Posting API needs an audited app — unaudited, it can only
 * post privately, which is not publishing. They implement the interface so the rest of the system
 * already handles them, and they are hidden from the connect screen until the flags are set.
 */
class NotYetProvider implements SocialProvider {
  constructor(
    readonly platform: SocialPlatform,
    readonly name: string,
    private readonly why: string,
  ) {}
  readonly requiresMedia = false;
  verify(): Promise<VerifiedAccount> {
    return Promise.reject(new Error(this.why));
  }
  publish(): Promise<PublishResult> {
    return Promise.resolve({ ok: false, error: this.why });
  }
}

export class XProvider extends NotYetProvider {
  constructor() {
    super(
      'X',
      'x',
      'Posting to X needs a paid X API tier, which this deployment has not been given.',
    );
  }
}

export class TikTokProvider extends NotYetProvider {
  constructor() {
    super(
      'TIKTOK',
      'tiktok',
      "Posting to TikTok needs an audited TikTok app; without the audit the API can only post privately, which isn't publishing.",
    );
  }
}

/** Logs what would have gone out and invents an id. Only when ALLOW_MOCK_SOCIAL says so. */
export class MockSocialProvider implements SocialProvider {
  private readonly log = new Logger('SocialMock');
  readonly requiresMedia = false;
  constructor(
    readonly platform: SocialPlatform,
    readonly name = 'mock',
  ) {}

  verify(): Promise<VerifiedAccount> {
    return Promise.resolve({
      externalId: `mock-${this.platform.toLowerCase()}`,
      displayName: `Mock ${this.platform}`,
      scopes: ['mock'],
    });
  }

  publish(_token: string, externalId: string, input: PublishInput): Promise<PublishResult> {
    this.log.log(`[${this.platform}] → ${externalId}: ${input.text.slice(0, 80)}`);
    return Promise.resolve({ ok: true, externalId: `mock_${Date.now()}` });
  }
}
