import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { WS_EVENTS, type ParticipantRole } from "@arutech/types";
import type { AssignBreakoutRoomDto, CreateBreakoutRoomsDto } from "@arutech/validation";
import { PrismaService } from "../prisma/prisma.service";
import { LiveKitService } from "../livekit/livekit.service";
import { PermissionService } from "../meetings/permission.service";
import { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";

const MODERATOR_ROLES: ParticipantRole[] = ["OWNER", "HOST", "CO_HOST", "TEACHER"];

@Injectable()
export class BreakoutRoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly liveKit: LiveKitService,
    private readonly permissions: PermissionService,
    private readonly broadcast: RealtimeBroadcastService,
  ) {}

  async create(meetingId: string, callerUserId: string, dto: CreateBreakoutRoomsDto) {
    await this.permissions.requireOwnerOrCapability(meetingId, callerUserId, "breakout.manage");
    const meeting = await this.prisma.client.meeting.findUniqueOrThrow({ where: { id: meetingId } });

    const rooms = await this.prisma.client.$transaction(
      dto.names.map((name, i) =>
        this.prisma.client.breakoutRoom.create({
          data: {
            meetingId,
            name,
            livekitRoomName: `${meeting.livekitRoomName}-breakout-${i}-${Date.now()}`,
          },
        }),
      ),
    );

    let assignments: { breakoutRoomId: string; userId: string }[] = [];
    if (dto.autoAssign) {
      const participants = await this.prisma.client.meetingParticipant.findMany({
        where: {
          meetingId,
          status: { in: ["ADMITTED", "JOINED"] },
          userId: { not: null },
          role: { notIn: MODERATOR_ROLES },
        },
      });
      assignments = participants.map((p, i) => ({
        breakoutRoomId: rooms[i % rooms.length]!.id,
        userId: p.userId as string,
      }));
      if (assignments.length > 0) {
        await this.prisma.client.breakoutRoomAssignment.createMany({ data: assignments });
      }
    }

    await this.broadcast.publish(meetingId, WS_EVENTS.BREAKOUT_ROOMS_CREATED, {
      rooms: rooms.map((r) => ({ id: r.id, name: r.name })),
      assignments,
    });
    return { rooms, assignments };
  }

  async list(meetingId: string, callerUserId: string) {
    await this.permissions.getParticipant(meetingId, callerUserId);
    return this.prisma.client.breakoutRoom.findMany({
      where: { meetingId, closedAt: null },
      include: {
        assignments: { include: { user: { select: { id: true, displayName: true } } } },
      },
    });
  }

  async assign(meetingId: string, callerUserId: string, dto: AssignBreakoutRoomDto) {
    await this.permissions.requireOwnerOrCapability(meetingId, callerUserId, "breakout.manage");
    const room = await this.prisma.client.breakoutRoom.findUnique({ where: { id: dto.breakoutRoomId } });
    if (!room || room.meetingId !== meetingId) throw new NotFoundException("Breakout room not found");

    await this.prisma.client.breakoutRoomAssignment.deleteMany({
      where: { userId: dto.userId, breakoutRoom: { meetingId } },
    });
    const assignment = await this.prisma.client.breakoutRoomAssignment.create({
      data: { breakoutRoomId: dto.breakoutRoomId, userId: dto.userId },
    });

    await this.broadcast.publish(meetingId, WS_EVENTS.BREAKOUT_ROOM_ASSIGNED, {
      userId: dto.userId,
      breakoutRoomId: dto.breakoutRoomId,
      roomName: room.name,
    });
    return assignment;
  }

  /** Issues a LiveKit token for a breakout room. Assigned members may join their
   * own room; moderators may join any room ("join any room" from the spec). */
  async issueToken(meetingId: string, callerUserId: string, breakoutRoomId: string) {
    const caller = await this.permissions.getParticipant(meetingId, callerUserId);
    const role = caller.role as ParticipantRole;
    const room = await this.prisma.client.breakoutRoom.findUnique({ where: { id: breakoutRoomId } });
    if (!room || room.meetingId !== meetingId || room.closedAt) {
      throw new NotFoundException("Breakout room not found");
    }

    const isModerator = MODERATOR_ROLES.includes(role);
    if (!isModerator) {
      const assignment = await this.prisma.client.breakoutRoomAssignment.findUnique({
        where: { breakoutRoomId_userId: { breakoutRoomId, userId: callerUserId } },
      });
      if (!assignment) throw new ForbiddenException("You are not assigned to this breakout room");
    }

    await this.liveKit.ensureRoom(room.livekitRoomName, 50);
    const token = await this.liveKit.createRoomToken({
      roomName: room.livekitRoomName,
      identity: caller.livekitIdentity,
      name: caller.guestName ?? callerUserId,
    });
    return { token, url: this.liveKit.getClientUrl() };
  }

  async broadcastMessage(meetingId: string, callerUserId: string, message: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, callerUserId, "breakout.manage");
    await this.broadcast.publish(meetingId, WS_EVENTS.BREAKOUT_BROADCAST, { message });
  }

  async closeAll(meetingId: string, callerUserId: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, callerUserId, "breakout.manage");
    const rooms = await this.prisma.client.breakoutRoom.findMany({ where: { meetingId, closedAt: null } });

    await Promise.all(rooms.map((r) => this.liveKit.endRoom(r.livekitRoomName)));
    await this.prisma.client.breakoutRoom.updateMany({
      where: { meetingId, closedAt: null },
      data: { closedAt: new Date() },
    });
    await this.broadcast.publish(meetingId, WS_EVENTS.BREAKOUT_ROOMS_CLOSED, {});
  }
}
