import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type Redis from "ioredis";
import { Public } from "../common/decorators/public.decorator";
import { PrismaService } from "../prisma/prisma.service";

@ApiExcludeController()
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject("REDIS") private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  async check() {
    const [dbOk, redisOk] = await Promise.all([this.checkDb(), this.checkRedis()]);
    const healthy = dbOk && redisOk;
    const body = {
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      dependencies: { postgres: dbOk ? "ok" : "down", redis: redisOk ? "ok" : "down" },
    };
    if (!healthy) throw new ServiceUnavailableException(body);
    return body;
  }

  private async checkDb(): Promise<boolean> {
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === "PONG";
    } catch {
      return false;
    }
  }
}
