import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { prisma, type PrismaClient } from "@arutech/database";

/**
 * Nest-lifecycle wrapper around the shared @arutech/database Prisma singleton,
 * so the connection pool is created/torn down alongside the application.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient = prisma;

  async onModuleInit() {
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
