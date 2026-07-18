import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';

/**
 * Tenant scoping for row-level security.
 *
 * The database decides what a query may see from `app.school_id`, a per-session setting, so it
 * must be set on the same connection as the query. Prisma only guarantees one connection inside
 * a transaction — so a request does its work inside a single transaction that sets the tenant
 * first, and every model access is routed to that transaction's client.
 *
 * Routing happens in a Proxy `get` trap rather than a Prisma client extension. Extension
 * callbacks are dispatched by Prisma outside the caller's async context, which loses
 * AsyncLocalStorage; a property access happens synchronously in the caller's own context, where
 * the context is reliably there. That distinction cost an afternoon, so it is written down.
 */
interface TenantStore {
  schoolId: string;
  tx: PrismaClient;
}

const als = new AsyncLocalStorage<TenantStore>();
const SET_TENANT = `SELECT set_config('app.school_id', $1, true)`;

export function currentSchoolId(): string | undefined {
  return als.getStore()?.schoolId;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /**
   * A second connection as the migration owner, which policies do not apply to.
   *
   * Only for work that genuinely has no tenant yet: signing in (an email, phone or admission
   * number identifies someone across schools) and gateway webhooks (the provider knows a
   * payment reference, not a school). Every use is a deliberate hole in the fence — keep them
   * few and obvious.
   */
  readonly system: PrismaClient;

  constructor() {
    // Connects as a NON-OWNER role so policies bite. Falling back to the owner keeps a bare
    // checkout working, but then RLS protects nothing — so it says so, loudly, at boot.
    const appUrl = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
    super({ datasources: { db: { url: appUrl } } });
    this.system = new PrismaClient();
  }

  async onModuleInit() {
    await this.$connect();
    await this.system.$connect();
    if (!process.env.APP_DATABASE_URL) {
      console.warn(
        '[prisma] APP_DATABASE_URL not set — connecting as the database owner, which BYPASSES ' +
          'row-level security. Point it at the eyo_app role before any real deployment.',
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.system.$disconnect();
  }

  /**
   * Run `fn` with `schoolId` in scope. Everything it touches goes through one transaction with
   * the tenant set, so the database — not a remembered where clause — decides what it can see.
   */
  async withTenant<T>(schoolId: string, fn: () => Promise<T>): Promise<T> {
    const existing = als.getStore();
    if (existing?.schoolId === schoolId) return fn(); // already inside this school's transaction
    return this.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(SET_TENANT, schoolId);
        return als.run({ schoolId, tx: tx as unknown as PrismaClient }, fn);
      },
      // Report generation and PDF building happen inside the request, so allow a generous
      // window before Postgres gives up on the transaction.
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  /** Lightweight audit trail for mutations. */
  async audit(
    schoolId: string,
    userId: string | null,
    action: string,
    entity: string,
    entityId?: string,
    detail?: object,
  ) {
    await this.auditLog.create({
      data: { schoolId, userId, action, entity, entityId, detail: detail as never },
    });
  }
}

/** Everything except these is a model name to be routed at the current tenant transaction. */
const PASSTHROUGH = new Set([
  'system',
  'audit',
  'withTenant',
  'onModuleInit',
  'onModuleDestroy',
  'constructor',
  'then',
]);

/**
 * Injected everywhere as `PrismaService`. Model access resolves to the request's tenant
 * transaction when one is open, and to the plain client otherwise — in which case the policies
 * see no tenant and return nothing, which is the safe direction to fail.
 */
export function tenantAware(base: PrismaService): PrismaService {
  return new Proxy(base, {
    get(target, prop, receiver) {
      /**
       * `$transaction` inside a request is a mistake, and it used to be a silent one.
       *
       * `$`-prefixed properties pass through to the base client, so a nested `$transaction` ran
       * on a different connection with no `app.school_id` — every write in it was refused by
       * RLS. That broke invoice generation, guardian edits and the term switch, and nothing said
       * so until a write actually failed at runtime.
       *
       * It is also unnecessary: `withTenant` already wraps the whole request in one transaction,
       * so sequential awaits are atomic. Throwing here turns a silent data bug into an obvious
       * developer error at the first call.
       */
      if (prop === '$transaction' && als.getStore()) {
        throw new Error(
          'Do not call $transaction inside a request: the whole request already runs in one ' +
            'tenant transaction, and a nested one escapes it and fails row-level security. ' +
            'Use sequential awaits instead.',
        );
      }
      if (typeof prop === 'string' && !PASSTHROUGH.has(prop) && !prop.startsWith('$')) {
        const store = als.getStore();
        if (store) {
          const scoped = (store.tx as unknown as Record<string, unknown>)[prop];
          if (scoped !== undefined) return scoped;
        }
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

let singleton: PrismaService | undefined;

/** For code outside Nest DI (the tenant interceptor, and auth flows before a principal exists). */
export function withTenant<T>(schoolId: string, fn: () => Promise<T>): Promise<T> {
  if (!singleton) throw new Error('PrismaService not initialised');
  return singleton.withTenant(schoolId, fn);
}

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: async () => {
        const base = new PrismaService();
        await base.onModuleInit();
        const aware = tenantAware(base);
        singleton = aware;
        return aware;
      },
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
