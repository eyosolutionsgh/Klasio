import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
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

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
