import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import type { Env } from "@arutech/config";
import { SETTABLE_PRESENCE_STATUSES, type SettablePresenceStatus, type UserPresenceStatus } from "@arutech/types";

// TTL on both Redis keys below, refreshed on every connect/heartbeat/status
// change. Not just belt-and-suspenders over RealtimeGateway.handleDisconnect
// firing on socket close (which Socket.IO's own ping/pong keepalive already
// makes fairly reliable even for a genuinely crashed tab — a dead connection
// gets disconnected server-side within its ping timeout) — this is what
// keeps a user from being stranded "online" forever if the *gateway process
// itself* crashes mid-connection, since in that case handleDisconnect never
// runs at all and nothing else would ever clear these keys.
const PRESENCE_TTL_SECONDS = 120;

/**
 * Real-time user presence (online/away/busy/DND), Redis-backed — the piece
 * several other features were built on top of before it existed
 * (docs/roadmap.md's Presence stage): "contacts online status" and "who's
 * actually online right now" in Team Chat both read from this, not from
 * `User.lastSeenAt` alone (Stage 24's "online status v1", which only ever
 * captured *the moment of connecting*, not whether the connection is still
 * open, and had no away/busy/DND concept at all — see that stage's doc
 * comment on `RealtimeGateway.handleConnection`).
 *
 * Two keys per user, namespaced under `env.REDIS_PREFIX` like every other
 * Redis use in this codebase:
 *   - `presence:sockets:{userId}` — a Set of this user's currently connected
 *     Socket.IO socket ids. Non-empty means "has at least one live
 *     connection" — multi-device/multi-tab correct by construction, since a
 *     second tab closing doesn't make the first tab's connection stop
 *     counting.
 *   - `presence:status:{userId}` — an explicit AWAY/BUSY/DND override, only
 *     ever present while the sockets set is also non-empty. Its absence
 *     while connected means "ONLINE" (the default, not written explicitly —
 *     saves a key for the common case). Both keys are cleared together the
 *     moment the sockets set goes empty: reconnecting after a genuine
 *     offline period always starts fresh at ONLINE rather than resuming
 *     whatever was explicitly set before — a deliberate v1 scope call, not
 *     an oversight (see docs/roadmap.md).
 */
@Injectable()
export class PresenceService {
  constructor(
    @Inject("REDIS") private readonly redis: Redis,
    @Inject("ENV") private readonly env: Env,
  ) {}

  private socketsKey(userId: string): string {
    return `${this.env.REDIS_PREFIX}:presence:sockets:${userId}`;
  }

  private statusKey(userId: string): string {
    return `${this.env.REDIS_PREFIX}:presence:status:${userId}`;
  }

  /** Returns true if this was the user's first connected socket (i.e. they
   * were fully offline immediately before this call) — the caller uses that
   * to decide whether an ONLINE transition is actually worth broadcasting. */
  async connect(userId: string, socketId: string): Promise<boolean> {
    const key = this.socketsKey(userId);
    const before = await this.redis.scard(key);
    await this.redis.sadd(key, socketId);
    await this.redis.expire(key, PRESENCE_TTL_SECONDS);
    return before === 0;
  }

  /** Returns true if this was the user's last connected socket (i.e. they're
   * now fully offline) — the caller uses that to decide whether to
   * broadcast an OFFLINE transition and clear any explicit status. */
  async disconnect(userId: string, socketId: string): Promise<boolean> {
    const key = this.socketsKey(userId);
    await this.redis.srem(key, socketId);
    const remaining = await this.redis.scard(key);
    if (remaining === 0) {
      await this.redis.del(key, this.statusKey(userId));
      return true;
    }
    return false;
  }

  /** Refreshes both keys' TTL without changing anything — see the class doc
   * comment on why this matters beyond handleDisconnect. A no-op if the user
   * has no connected sockets recorded (nothing to refresh). */
  async heartbeat(userId: string): Promise<void> {
    const key = this.socketsKey(userId);
    const exists = await this.redis.exists(key);
    if (!exists) return;
    await this.redis.expire(key, PRESENCE_TTL_SECONDS);
    await this.redis.expire(this.statusKey(userId), PRESENCE_TTL_SECONDS);
  }

  /** No-op (returns false) if the user has no connected socket right now —
   * matches "you can't set a status while offline" (there'd be nothing to
   * broadcast to, and nothing left to expire it back to ONLINE). */
  async setStatus(userId: string, status: SettablePresenceStatus): Promise<boolean> {
    if (!SETTABLE_PRESENCE_STATUSES.includes(status)) return false;
    const socketsKey = this.socketsKey(userId);
    const connected = await this.redis.exists(socketsKey);
    if (!connected) return false;
    if (status === "ONLINE") {
      await this.redis.del(this.statusKey(userId));
    } else {
      await this.redis.set(this.statusKey(userId), status, "EX", PRESENCE_TTL_SECONDS);
    }
    await this.redis.expire(socketsKey, PRESENCE_TTL_SECONDS);
    return true;
  }

  async getStatus(userId: string): Promise<UserPresenceStatus> {
    const connected = await this.redis.exists(this.socketsKey(userId));
    if (!connected) return "OFFLINE";
    const status = await this.redis.get(this.statusKey(userId));
    return (status as SettablePresenceStatus | null) ?? "ONLINE";
  }

  /** Batched via a pipeline — one Redis round trip for however many users
   * are being looked up (a contacts list, a chat room's member list),
   * rather than 2*N sequential EXISTS/GET calls. */
  async getStatuses(userIds: string[]): Promise<Record<string, UserPresenceStatus>> {
    if (userIds.length === 0) return {};
    const pipeline = this.redis.pipeline();
    for (const userId of userIds) {
      pipeline.exists(this.socketsKey(userId));
      pipeline.get(this.statusKey(userId));
    }
    const results = await pipeline.exec();
    const out: Record<string, UserPresenceStatus> = {};
    userIds.forEach((userId, i) => {
      const connected = results?.[i * 2]?.[1] as number | undefined;
      const status = results?.[i * 2 + 1]?.[1] as string | null | undefined;
      out[userId] = !connected ? "OFFLINE" : ((status as SettablePresenceStatus | null) ?? "ONLINE");
    });
    return out;
  }
}
