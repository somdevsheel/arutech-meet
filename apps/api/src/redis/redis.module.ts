import { Global, Module } from "@nestjs/common";
import Redis from "ioredis";
import type { Env } from "@arutech/config";

const redisProvider = {
  provide: "REDIS",
  useFactory: (env: Env) => new Redis(env.REDIS_URL, { lazyConnect: false }),
  inject: ["ENV"],
};

/**
 * Global Redis client — used for presence, distributed locks, rate limiting,
 * waiting-room queues, and the Socket.IO cross-instance adapter. Never used as a
 * durable store; PostgreSQL remains the source of truth for everything here.
 */
@Global()
@Module({
  providers: [redisProvider],
  exports: [redisProvider],
})
export class RedisModule {}
