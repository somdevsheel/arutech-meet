import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import type { Env } from "@arutech/config";

export function meetingChannel(env: Env, meetingId: string): string {
  return `${env.REDIS_PREFIX}:meeting:${meetingId}`;
}

/**
 * Publishes app-level realtime events (moderation actions, waiting-room decisions,
 * recording state, etc.) onto Redis. REST controllers/services call this instead of
 * depending on the WebSocket gateway directly — RealtimeGateway subscribes to these
 * channels independently and fans them out to connected Socket.IO clients. This keeps
 * MeetingsModule decoupled from RealtimeModule and lets any API instance trigger a
 * broadcast that reaches clients connected to any WebSocket gateway instance.
 */
@Injectable()
export class RealtimeBroadcastService {
  constructor(
    @Inject("REDIS") private readonly redis: Redis,
    @Inject("ENV") private readonly env: Env,
  ) {}

  async publish(meetingId: string, event: string, payload: unknown): Promise<void> {
    await this.redis.publish(
      meetingChannel(this.env, meetingId),
      JSON.stringify({ event, payload }),
    );
  }
}
