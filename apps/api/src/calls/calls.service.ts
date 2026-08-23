import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { InitiateCallDto } from "@arutech/validation";
import { WS_EVENTS, type CallIncomingPayload, type CallUserSummary } from "@arutech/types";
import { PrismaService } from "../prisma/prisma.service";
import { LiveKitService } from "../livekit/livekit.service";
import { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ContactsService } from "../contacts/contacts.service";

/** How long an unanswered call rings before being marked MISSED. In-process
 * timer, not a persisted job — see the class doc comment for what that means
 * in practice. */
const RING_TIMEOUT_MS = 45_000;

const USER_SELECT = { id: true, displayName: true, avatarUrl: true } as const;

function userRoom(userId: string): string {
  return `user:${userId}`;
}

/**
 * Real 1:1/group calling — ring, accept, reject, busy, missed, call history —
 * built on the `Call`/`CallParticipant` schema that existed unused since
 * Stage 2. Reuses the exact same media infrastructure meetings do (LiveKit
 * room + token, via LiveKitService) rather than a second media engine — a
 * call is architecturally just a lighter-weight room with no `Meeting` row,
 * no waiting room, no recording, no settings: two or more `CallParticipant`s
 * ringing/joining a `livekitRoomName`.
 *
 * Previously `ContactsService.call` created an instant `Meeting` and pushed a
 * notification instead of a real ring/accept/decline flow — this service is
 * what that was deliberately scoped around; `ContactsService.call` now calls
 * into this instead (see contacts.service.ts).
 *
 * **Known v1 limitation, stated plainly**: the missed-call timeout is an
 * in-process `setTimeout`, not a persisted/queued job — if this API instance
 * restarts while a call is ringing, that call never gets marked MISSED (it
 * just stays RINGING forever in the database, though the caller/callee's own
 * sockets will have already disconnected on restart, so no live UI is
 * actually stuck). A cron sweep (`WHERE status = 'RINGING' AND createdAt <
 * now() - interval`) is the natural, cheap follow-up once this needs to
 * survive restarts mid-ring.
 */
@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);
  /** Pending ring-timeout handles, keyed by callId — cleared the moment a call
   * leaves RINGING (accepted/rejected/canceled) so answering a call promptly
   * doesn't leave a 45s timer alive in memory for no reason. Purely an
   * in-process optimization; `expireIfStillRinging` itself is already
   * idempotent/safe to run late or not at all (it no-ops if the call isn't
   * RINGING anymore), so this map is not a correctness requirement — see the
   * class doc comment on why a restart mid-ring is still a known gap regardless. */
  private readonly ringTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly liveKit: LiveKitService,
    private readonly broadcast: RealtimeBroadcastService,
    private readonly notifications: NotificationsService,
    private readonly contacts: ContactsService,
  ) {}

  async initiate(callerId: string, dto: InitiateCallDto) {
    if (dto.calleeUserIds.includes(callerId)) {
      throw new BadRequestException("You can't call yourself");
    }
    // Symmetric block check (either direction) — see ContactsService.isBlocked.
    // 1:1 only in practice today, but checking every callee keeps this correct
    // once group calling ships (docs/roadmap.md Stage 15's own "not yet built").
    for (const calleeId of dto.calleeUserIds) {
      if (await this.contacts.isBlocked(callerId, calleeId)) {
        throw new ForbiddenException("You can't call this person");
      }
    }
    const callees = await this.prisma.client.user.findMany({
      where: { id: { in: dto.calleeUserIds }, deletedAt: null },
      select: USER_SELECT,
    });
    if (callees.length !== dto.calleeUserIds.length) {
      throw new NotFoundException("One or more callees not found");
    }

    // 1:1 only for now (see docs/roadmap.md) — if the single callee already
    // has another call in progress, fail fast with "busy" rather than ever
    // ringing them for a call they can't answer.
    if (callees.length === 1) {
      const busy = await this.prisma.client.callParticipant.findFirst({
        where: { userId: callees[0]!.id, status: "JOINED", call: { status: "ONGOING" } },
      });
      if (busy) throw new ConflictException("This person is on another call");
    }

    const caller = await this.prisma.client.user.findUniqueOrThrow({ where: { id: callerId }, select: USER_SELECT });
    const livekitRoomName = `call-${randomUUID()}`;
    await this.liveKit.ensureRoom(livekitRoomName, 2 + callees.length);

    const call = await this.prisma.client.call.create({
      data: {
        type: dto.type,
        status: "RINGING",
        initiatorId: callerId,
        livekitRoomName,
        participants: {
          create: [
            { userId: callerId, status: "JOINED", joinedAt: new Date() },
            ...callees.map((c) => ({ userId: c.id, status: "RINGING" as const })),
          ],
        },
      },
    });

    const token = await this.liveKit.createRoomToken({
      roomName: livekitRoomName,
      identity: `${callerId}-${randomUUID().slice(0, 8)}`,
      name: callerId,
    });

    const payload: CallIncomingPayload = {
      callId: call.id,
      type: call.type,
      livekitRoomName,
      initiator: caller,
    };
    for (const callee of callees) {
      await this.broadcast.publishToRoom(userRoom(callee.id), WS_EVENTS.CALL_INCOMING, payload);
      await this.notifications.create({
        userId: callee.id,
        type: "CALL_INCOMING",
        title: `${caller.displayName} is calling you`,
        body: call.type === "VIDEO" ? "Incoming video call" : "Incoming voice call",
        data: { callId: call.id },
      });
    }

    const timeout = setTimeout(() => {
      this.ringTimeouts.delete(call.id);
      this.expireIfStillRinging(call.id).catch((err) =>
        this.logger.error(`Failed to expire ringing call ${call.id}: ${String(err)}`),
      );
    }, RING_TIMEOUT_MS);
    this.ringTimeouts.set(call.id, timeout);

    return { callId: call.id, token, url: this.liveKit.getClientUrl(), livekitRoomName };
  }

  private clearRingTimeout(callId: string): void {
    const timeout = this.ringTimeouts.get(callId);
    if (timeout) {
      clearTimeout(timeout);
      this.ringTimeouts.delete(callId);
    }
  }

  private async expireIfStillRinging(callId: string): Promise<void> {
    const call = await this.prisma.client.call.findUnique({ where: { id: callId } });
    if (!call || call.status !== "RINGING") return; // already answered/canceled/declined

    await this.prisma.client.call.update({ where: { id: callId }, data: { status: "MISSED", endedAt: new Date() } });
    await this.prisma.client.callParticipant.updateMany({
      where: { callId, status: "RINGING" },
      data: { status: "MISSED" },
    });

    const participants = await this.prisma.client.callParticipant.findMany({ where: { callId } });
    for (const p of participants) {
      await this.broadcast.publishToRoom(userRoom(p.userId), WS_EVENTS.CALL_ENDED, { callId, reason: "missed" });
    }
    // Missed-call notification only to whoever didn't pick up — the caller
    // already knows (their own screen was showing "ringing" the whole time).
    for (const p of participants) {
      if (p.userId === call.initiatorId) continue;
      await this.notifications.create({
        userId: p.userId,
        type: "CALL_INCOMING",
        title: "Missed call",
        body: "You missed a call.",
        data: { callId },
      });
    }
  }

  async accept(calleeId: string, callId: string) {
    const participant = await this.getParticipantOrThrow(callId, calleeId);
    if (participant.status !== "RINGING") {
      throw new BadRequestException("This call is no longer ringing");
    }
    const call = await this.prisma.client.call.findUniqueOrThrow({ where: { id: callId } });

    await this.prisma.client.callParticipant.update({
      where: { id: participant.id },
      data: { status: "JOINED", joinedAt: new Date() },
    });
    if (call.status === "RINGING") {
      await this.prisma.client.call.update({
        where: { id: callId },
        data: { status: "ONGOING", startedAt: new Date() },
      });
      this.clearRingTimeout(callId);
    }

    const token = await this.liveKit.createRoomToken({
      roomName: call.livekitRoomName,
      identity: `${calleeId}-${randomUUID().slice(0, 8)}`,
      name: calleeId,
    });

    const others = await this.prisma.client.callParticipant.findMany({
      where: { callId, userId: { not: calleeId } },
    });
    for (const o of others) {
      await this.broadcast.publishToRoom(userRoom(o.userId), WS_EVENTS.CALL_ACCEPTED, { callId, byUserId: calleeId });
    }

    return { token, url: this.liveKit.getClientUrl(), livekitRoomName: call.livekitRoomName };
  }

  async reject(calleeId: string, callId: string) {
    const participant = await this.getParticipantOrThrow(callId, calleeId);
    await this.prisma.client.callParticipant.update({ where: { id: participant.id }, data: { status: "DECLINED" } });

    const remainingRinging = await this.prisma.client.callParticipant.count({ where: { callId, status: "RINGING" } });
    if (remainingRinging === 0) {
      await this.prisma.client.call.update({
        where: { id: callId },
        data: { status: "DECLINED", endedAt: new Date() },
      });
      this.clearRingTimeout(callId);
    }

    const others = await this.prisma.client.callParticipant.findMany({
      where: { callId, userId: { not: calleeId } },
    });
    for (const o of others) {
      await this.broadcast.publishToRoom(userRoom(o.userId), WS_EVENTS.CALL_REJECTED, { callId, byUserId: calleeId });
    }
  }

  /** Caller-only: hang up before anyone has answered. */
  async cancel(callerId: string, callId: string): Promise<void> {
    const call = await this.prisma.client.call.findUniqueOrThrow({ where: { id: callId } });
    if (call.initiatorId !== callerId) throw new ForbiddenException("Only the caller can cancel");
    if (call.status !== "RINGING") throw new BadRequestException("This call was already answered or ended");

    await this.prisma.client.call.update({ where: { id: callId }, data: { status: "CANCELED", endedAt: new Date() } });
    this.clearRingTimeout(callId);
    const others = await this.prisma.client.callParticipant.findMany({
      where: { callId, userId: { not: callerId } },
    });
    for (const o of others) {
      await this.broadcast.publishToRoom(userRoom(o.userId), WS_EVENTS.CALL_ENDED, { callId, reason: "canceled" });
    }
  }

  /** Either party hangs up an ongoing call. A 1:1 call ends for both the
   * moment either side leaves — matching how a real phone call works — group
   * calls (more than two participants) continue until everyone has left.
   * Found by live-testing: an earlier version of this only ever updated the
   * hanger-up's own row, so in a 1:1 call the other side's `CallParticipant`
   * stayed `JOINED` forever (its owner had no reason to call `end` again —
   * their screen had already gone back to idle from the `CALL_ENDED`
   * broadcast) and the `Call` itself stayed `ONGOING` in the database,
   * which then incorrectly tripped the "busy" check on the very next call
   * between the same two people. */
  async end(userId: string, callId: string): Promise<void> {
    const participant = await this.getParticipantOrThrow(callId, userId);
    await this.prisma.client.callParticipant.update({
      where: { id: participant.id },
      data: { status: "LEFT", leftAt: new Date() },
    });

    const totalParticipants = await this.prisma.client.callParticipant.count({ where: { callId } });
    const stillJoined = await this.prisma.client.callParticipant.count({ where: { callId, status: "JOINED" } });
    if (stillJoined === 0 || totalParticipants <= 2) {
      await this.prisma.client.call.update({ where: { id: callId }, data: { status: "ENDED", endedAt: new Date() } });
      await this.prisma.client.callParticipant.updateMany({
        where: { callId, status: "JOINED" },
        data: { status: "LEFT", leftAt: new Date() },
      });
    }

    const others = await this.prisma.client.callParticipant.findMany({
      where: { callId, userId: { not: userId } },
    });
    for (const o of others) {
      await this.broadcast.publishToRoom(userRoom(o.userId), WS_EVENTS.CALL_ENDED, { callId, reason: "ended" });
    }
  }

  async history(userId: string) {
    const rows = await this.prisma.client.callParticipant.findMany({
      where: { userId },
      include: {
        call: {
          include: {
            initiator: { select: USER_SELECT },
            participants: { include: { user: { select: USER_SELECT } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return rows.map((r) => ({
      callId: r.call.id,
      type: r.call.type,
      status: r.call.status,
      startedAt: r.call.startedAt,
      endedAt: r.call.endedAt,
      wasIncoming: r.call.initiatorId !== userId,
      otherParticipants: r.call.participants
        .filter((p) => p.userId !== userId)
        .map((p): CallUserSummary => p.user),
    }));
  }

  private async getParticipantOrThrow(callId: string, userId: string) {
    const participant = await this.prisma.client.callParticipant.findUnique({
      where: { callId_userId: { callId, userId } },
    });
    if (!participant) throw new NotFoundException("You're not part of this call");
    return participant;
  }
}
