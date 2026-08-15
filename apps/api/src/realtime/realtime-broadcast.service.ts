import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import type { Env } from "@arutech/config";

export function meetingChannel(env: Env, meetingId: string): string {
  return `${env.REDIS_PREFIX}:meeting:${meetingId}`;
}

/** Separate namespace from meetingChannel above — that one reconstructs the
 * target room by splitting the channel name on ":" and always prefixing
 * "meeting:", which silently breaks for any room name that isn't a bare
 * meeting id (e.g. "user:{id}" — the ":" inside it gets mangled the same
 * way). This one instead carries the exact target room in the message body,
 * so the subscriber never has to reconstruct it. */
export function roomBroadcastChannel(env: Env): string {
  return `${env.REDIS_PREFIX}:room-broadcast`;
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

  /** Meeting-scoped broadcast — `meetingId` is a bare id, the gateway always
   * fans it out to the `meeting:{id}` Socket.IO room. */
  async publish(meetingId: string, event: string, payload: unknown): Promise<void> {
    await this.redis.publish(
      meetingChannel(this.env, meetingId),
      JSON.stringify({ event, payload }),
    );
  }

  /** Broadcast to an arbitrary, already-fully-qualified Socket.IO room (e.g.
   * `user:{id}` for a personal notification channel, `chatroom:{id}` for team
   * chat) — use this whenever the target isn't a meeting room. */
  async publishToRoom(room: string, event: string, payload: unknown): Promise<void> {
    await this.redis.publish(roomBroadcastChannel(this.env), JSON.stringify({ room, event, payload }));
  }
}
