/**
 * First-run setup, and the handful of things an unauthenticated page needs to know.
 *
 * There is no vendor console any more, so nothing reaches into this box to create the school.
 * Instead the first person to open a fresh install lands on /setup and creates it themselves.
 *
 * ## What guards it
 *
 * A row count. `POST /public/setup` refuses with 409 once a School exists, and that is the entire
 * security model. Deliberately not a token: a setup token would have to be generated somewhere,
 * shown somewhere, and stored somewhere, and each of those is a place it can leak. A row count
 * cannot leak, cannot be replayed, and closes permanently the moment it has been used once.
 *
 * The window is real but small and self-closing: between `docker compose up` and someone
 * completing the form, anyone who can reach the box can claim it. That is the same window every
 * self-hosted product has, and the honest mitigation is the one in the docs — do not expose the
 * port until you have run setup.
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  OnModuleInit,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService, withTenant } from '../prisma/prisma.service';
import { Public, signToken, type AuthUser } from '../common/auth';
import { BCRYPT_ROUNDS, publicToken } from '../common/crypto';
import { ROLE_PRESETS, sanitizePermissions } from '../common/permissions';
import { rememberSchoolId, singletonSchool, singletonSchoolId } from '../common/school-context';
import { storage } from '../common/storage';
import { LicenceService } from '../licence/licence.service';

class SetupDto {
  @IsString() @MinLength(2) @MaxLength(120) schoolName: string;
  @IsString() @MinLength(2) @MaxLength(120) ownerName: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  /**
   * Optional at setup. A school installing from a vendor-issued file can paste it here and be
   * on the right package from its first login, rather than starting on BASIC and wondering why
   * half the product is missing.
   */
  @IsOptional() @IsString() licence?: string;
}

/** `Brighton Academy` → `brighton-academy`. */
function slugStem(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'school'
  );
}

@Injectable()
export class SetupService implements OnModuleInit {
  private readonly log = new Logger('Setup');

  constructor(
    private db: PrismaService,
    private licence: LicenceService,
  ) {}

  /**
   * Unattended install. Lets `docker compose up` produce a working box with no browser, which is
   * what a technician setting up a school on a Saturday actually wants.
   */
  async onModuleInit() {
    const { SETUP_SCHOOL_NAME, SETUP_OWNER_EMAIL, SETUP_OWNER_PASSWORD, SETUP_OWNER_NAME } =
      process.env;
    if (!SETUP_SCHOOL_NAME || !SETUP_OWNER_EMAIL || !SETUP_OWNER_PASSWORD) return;
    if (!(await this.needsSetup())) return;

    try {
      await this.run({
        schoolName: SETUP_SCHOOL_NAME,
        ownerName: SETUP_OWNER_NAME ?? 'Owner',
        email: SETUP_OWNER_EMAIL,
        password: SETUP_OWNER_PASSWORD,
      });
      this.log.log(`Created "${SETUP_SCHOOL_NAME}" and its owner from SETUP_* environment.`);
    } catch (e) {
      this.log.error(`Unattended setup failed: ${String(e)}`);
    }
  }

  async needsSetup(): Promise<boolean> {
    return (await this.db.system.school.count()) === 0;
  }

  async run(dto: SetupDto) {
    // Re-checked here rather than only in the controller: the unattended path calls straight in,
    // and "the door is closed" must be one decision made in one place.
    if (!(await this.needsSetup())) {
      throw new ConflictException('This server has already been set up. Sign in instead.');
    }

    const email = dto.email.toLowerCase();
    const name = dto.schoolName.trim();

    /**
     * No tenant exists yet, so this is the same deliberate use of the unscoped client that
     * `login` opens with. RLS on School would refuse the insert under the app role anyway —
     * `app.school_id` cannot name a row that does not exist.
     *
     * The school is created BASIC and stays BASIC until a licence says otherwise. A tier is never
     * something the form can name.
     */
    const stem = slugStem(name);
    let school: { id: string; name: string; slug: string; currency: string } | null = null;
    for (let attempt = 0; attempt < 5 && !school; attempt++) {
      const slug = attempt === 0 ? stem : `${stem}-${publicToken(4).toLowerCase()}`;
      try {
        school = await this.db.system.school.create({
          data: { name, slug },
          select: { id: true, name: true, slug: true, currency: true },
        });
      } catch (e) {
        // Slug collision only — anything else is a real failure and must not be retried.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    if (!school) throw new ConflictException('Could not create that school. Try a different name.');
    rememberSchoolId(school.id);

    const user = await this.db.system.user.create({
      data: {
        schoolId: school.id,
        name: dto.ownerName.trim(),
        email,
        role: 'OWNER',
        passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
      },
      select: { id: true, name: true, email: true, role: true },
    });

    /**
     * From here the school exists, so everything runs scoped to it — `audit` writes through the
     * tenant-aware proxy and RLS would refuse it outside.
     *
     * Deliberately minimal: a School, an OWNER and the standard staff roles. It invents no
     * academic year, no terms and no levels — those are the school's own facts, and a wrong
     * calendar quietly attached to every record is worse than an empty one the owner fills in.
     */
    await withTenant(school.id, async () => {
      for (const preset of ROLE_PRESETS) {
        await this.db.staffRole.create({
          data: {
            schoolId: school!.id,
            name: preset.name,
            description: preset.description,
            permissions: sanitizePermissions(preset.permissions),
            presetKey: preset.key,
          },
        });
      }
      await this.db.audit(school!.id, user.id, 'school.created', 'School', school!.id, {
        name: school!.name,
      });
    });

    const auth: AuthUser = {
      sub: user.id,
      schoolId: school.id,
      role: 'OWNER',
      tier: 'BASIC',
      name: user.name,
      tokenVersion: 0,
    };

    /**
     * The licence is applied last and never fatally.
     *
     * A school that pasted a licence with a typo should end up set up and on BASIC with a message
     * on the licence screen — not with a half-created school and a 400. Everything above is
     * already committed by this point, and re-running setup is impossible by design.
     */
    let licenceError: string | null = null;
    if (dto.licence?.trim()) {
      try {
        await withTenant(school.id, () => this.licence.install(dto.licence!.trim(), auth));
      } catch (e) {
        licenceError = e instanceof Error ? e.message : 'That licence could not be installed';
        this.log.warn(`Setup completed but the licence was refused: ${licenceError}`);
      }
    }
    await this.licence.refresh();
    const tier = this.licence.snapshot().tier;

    return {
      token: signToken({ ...auth, tier }),
      user,
      school: { id: school.id, name: school.name, slug: school.slug, currency: school.currency },
      licenceError,
    };
  }
}

/**
 * Everything here is `@Public()` by intent, and kept in its own controller so nothing sits one
 * careless edit away from exposing a route that assumed a principal — the same reasoning as the
 * public admissions and auth controllers.
 */
@Controller('public')
export class PublicController {
  constructor(
    private db: PrismaService,
    private setup: SetupService,
  ) {}

  /**
   * What the sign-in pages need before anyone has signed in: whose school this is.
   *
   * Impossible before this pivot — a shared hostname could not tell which school was at the door,
   * which is why every login page was generically branded. One school per box makes it trivial
   * and safe: a name, a colour and whether there is a crest to fetch.
   */
  @Public()
  @Get('branding')
  async branding() {
    const school = await singletonSchool(this.db);
    if (!school) return { configured: false, needsSetup: true, name: null };
    // Which sign-in pages this school has put its own photograph on. Slots only: the pages need
    // to know whether to ask for the school's picture or fall back to the one we ship, and that
    // is the whole of it.
    const photos = await this.db.system.brandPhoto.findMany({
      where: { schoolId: school.id },
      select: { slot: true },
    });

    return {
      configured: true,
      needsSetup: false,
      name: school.name,
      motto: school.motto,
      brandColor: school.brandColor,
      hasLogo: school.hasLogo,
      photoSlots: photos.map((p) => p.slot),
    };
  }

  /**
   * The crest, to anyone who asks.
   *
   * This is the one deliberate hole in the "every stored object is behind auth" rule in
   * common/storage.ts, and it is narrow: a school crest is institutional artwork — it is on the
   * uniforms, the letterhead and the gate — not child data. The login page cannot show it any
   * other way, because nobody has a session yet. Still bytes through the API, never a storage URL,
   * so it stays revocable.
   */
  @Public()
  @Get('branding/logo')
  async logo() {
    const school = await this.db.system.school.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { logoUrl: true, logoMimeType: true },
    });
    if (!school?.logoUrl) throw new NotFoundException('No crest uploaded');
    const buf = await storage().get(school.logoUrl);
    // The stored type, not a guess. This route serves the open internet, where sniffing a jpeg
    // sent as image/png is the browser being forgiving rather than us being correct.
    return new StreamableFile(buf, { type: school.logoMimeType ?? 'image/png' });
  }

  /**
   * A sign-in photograph, to anyone who asks.
   *
   * Same carve-out as the crest above, and the same narrowness: this is imagery the school
   * deliberately chose to show the public on its own front door. A slot the school has not set
   * 404s, and the page falls back to the picture the product ships with.
   */
  @Public()
  @Get('branding/photo/:slot')
  async photo(@Param('slot') slot: string) {
    const schoolId = await singletonSchoolId(this.db);
    if (!schoolId) throw new NotFoundException('Not found');
    const photo = await this.db.system.brandPhoto.findFirst({
      where: { schoolId, slot: slot.toUpperCase() as never },
    });
    if (!photo) throw new NotFoundException('Not found');
    return new StreamableFile(await storage().get(photo.key), { type: photo.mimeType });
  }

  @Public()
  @Get('setup/state')
  async state() {
    return { needsSetup: await this.setup.needsSetup() };
  }

  @Public()
  @Post('setup')
  async create(@Body() dto: SetupDto) {
    if (!dto.email.includes('@'))
      throw new BadRequestException('A valid email address is required');
    return this.setup.run(dto);
  }
}

@Module({
  controllers: [PublicController],
  providers: [SetupService],
  exports: [SetupService],
})
export class SetupModule {}
