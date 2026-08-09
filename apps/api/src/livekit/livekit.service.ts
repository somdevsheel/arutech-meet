import { Inject, Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
  WebhookReceiver,
  type VideoGrant,
} from "livekit-server-sdk";
import type { Env } from "@arutech/config";

export interface GrantOptions {
  roomName: string;
  identity: string;
  name: string;
  canPublish?: boolean;
  canPublishScreenShare?: boolean;
  metadata?: string;
}

/**
 * The ONLY place the application talks to the LiveKit SFU. The backend never proxies
 * media — it authorizes participants (issues a signed, short-lived room-scoped JWT)
 * and performs moderation actions via LiveKit's server API (which are enforced by the
 * SFU itself, not just reflected in our UI).
 */
@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);
  private readonly roomService: RoomServiceClient;
  private readonly webhookReceiver: WebhookReceiver;

  constructor(@Inject("ENV") private readonly env: Env) {
    this.roomService = new RoomServiceClient(
      this.env.LIVEKIT_HTTP_URL,
      this.env.LIVEKIT_API_KEY,
      this.env.LIVEKIT_API_SECRET,
    );
    this.webhookReceiver = new WebhookReceiver(this.env.LIVEKIT_API_KEY, this.env.LIVEKIT_API_SECRET);
  }

  async createRoomToken(opts: GrantOptions): Promise<string> {
    const at = new AccessToken(this.env.LIVEKIT_API_KEY, this.env.LIVEKIT_API_SECRET, {
      identity: opts.identity,
      name: opts.name,
      metadata: opts.metadata,
      ttl: "10m", // room join tokens are single-use-ish and short-lived; client reconnects re-request one
    });

    // Deliberately no `roomAdmin`/`roomRecord` grant here: those would let the token
    // holder call LiveKit's server API directly with their own client, bypassing our
    // backend's permission checks entirely. Every moderation action in this system
    // (mute, remove, promote, start/stop recording) is instead performed server-to-
    // server by this service using our own API key/secret, after PermissionService
    // has authorized the caller — see docs/security.md §Authorization.
    const grant: VideoGrant = {
      room: opts.roomName,
      roomJoin: true,
      canPublish: opts.canPublish ?? true,
      canSubscribe: true,
      canPublishData: true,
      canPublishSources: opts.canPublishScreenShare
        ? [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
        : [TrackSource.CAMERA, TrackSource.MICROPHONE],
    };
    at.addGrant(grant);
    return at.toJwt();
  }

  async ensureRoom(roomName: string, maxParticipants: number, emptyTimeoutSec = 300) {
    try {
      await this.roomService.createRoom({
        name: roomName,
        emptyTimeout: emptyTimeoutSec,
        maxParticipants,
      });
    } catch (err) {
      this.logger.debug(`ensureRoom(${roomName}) — room may already exist: ${String(err)}`);
    }
  }

  async endRoom(roomName: string): Promise<void> {
    try {
      await this.roomService.deleteRoom(roomName);
    } catch (err) {
      this.logger.warn(`endRoom(${roomName}) failed: ${String(err)}`);
    }
  }

  async removeParticipant(roomName: string, identity: string): Promise<void> {
    try {
      await this.roomService.removeParticipant(roomName, identity);
    } catch (err) {
      throw new InternalServerErrorException(`Failed to remove participant: ${String(err)}`);
    }
  }

  /** Force-mutes a participant's microphone (or camera) at the SFU. Looks up the
   * participant's currently published track for that source and mutes it there —
   * this actually stops the media from flowing, it does not just hide it in the UI. */
  async muteParticipantTrack(
    roomName: string,
    identity: string,
    source: "microphone" | "camera",
  ): Promise<void> {
    const participant = await this.roomService.getParticipant(roomName, identity);
    const track = participant.tracks.find((t) =>
      source === "microphone"
        ? t.source === TrackSource.MICROPHONE
        : t.source === TrackSource.CAMERA,
    );
    if (!track) return; // nothing published on that source right now — nothing to mute
    await this.roomService.mutePublishedTrack(roomName, identity, track.sid, true);
  }

  async listParticipants(roomName: string) {
    return this.roomService.listParticipants(roomName);
  }

  /** Applies an updated publish-source grant to an already-connected participant
   * immediately at the SFU (e.g. a promoted co-host gains screen-share rights without
   * waiting for a reconnect). This updates the *runtime* ParticipantPermission LiveKit
   * enforces for the live connection — a distinct mechanism from the `roomAdmin` JWT
   * grant, which we never issue to clients (see createRoomToken). */
  async updateParticipantPermissions(
    roomName: string,
    identity: string,
    opts: { canPublishScreenShare: boolean },
  ): Promise<void> {
    try {
      await this.roomService.updateParticipant(roomName, identity, undefined, {
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canPublishSources: opts.canPublishScreenShare
          ? [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
          : [TrackSource.CAMERA, TrackSource.MICROPHONE],
      });
    } catch (err) {
      // Participant may not be connected yet (still admitted-but-not-joined) — the
      // updated grant will apply on their next token issuance regardless.
      this.logger.debug(`updateParticipantPermissions(${roomName}, ${identity}): ${String(err)}`);
    }
  }

  /** Verifies a LiveKit webhook payload's Authorization header signature and parses it. */
  async receiveWebhook(body: string, authHeader: string) {
    return this.webhookReceiver.receive(body, authHeader);
  }

  /** The WebSocket URL clients use to connect directly to the SFU (never proxied through the API). */
  getClientUrl(): string {
    return this.env.LIVEKIT_URL;
  }
}
