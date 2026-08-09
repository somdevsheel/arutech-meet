import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ConfigModule } from "./config/config.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { MeetingsModule } from "./meetings/meetings.module";
import { ChatModule } from "./chat/chat.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { LiveKitModule } from "./livekit/livekit.module";
import { HealthModule } from "./health/health.module";

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
    }),
    AuthModule,
    UsersModule,
    OrganizationsModule,
    MeetingsModule,
    ChatModule,
    RealtimeModule,
    LiveKitModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
