import { ForbiddenException, Injectable } from "@nestjs/common";
import type { SaveWhiteboardPageDto } from "@arutech/validation";
import { PrismaService } from "../prisma/prisma.service";
import { PermissionService } from "../meetings/permission.service";
import { FeatureFlagsService } from "../feature-flags/feature-flags.service";

@Injectable()
export class WhiteboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  /** Gets or lazily creates the (single, for now) whiteboard for a meeting.
   * Every whiteboard interaction (open the panel, save a page, add a page)
   * goes through this first, making it the one real choke point to gate on
   * WHITEBOARD — see docs/roadmap.md's Feature flags stage for why this is
   * one of only three flags actually wired to a server-enforced check. */
  async getOrCreate(meetingId: string, callerUserId: string) {
    await this.permissions.getParticipant(meetingId, callerUserId);
    if (!(await this.featureFlags.isEnabledForMeeting("WHITEBOARD", meetingId))) {
      throw new ForbiddenException("Whiteboard is disabled for this meeting");
    }

    const existing = await this.prisma.client.whiteboard.findFirst({
      where: { meetingId },
      include: { pages: { orderBy: { index: "asc" } } },
    });
    if (existing) return existing;

    return this.prisma.client.whiteboard.create({
      data: {
        meetingId,
        createdByUserId: callerUserId,
        pages: { create: { index: 0, data: {} } },
      },
      include: { pages: true },
    });
  }

  /** Persists a full-page checkpoint (called periodically/on page-flip by the
   * client — the live stroke-by-stroke sync itself is WS-only and ephemeral, see
   * RealtimeGateway's `whiteboard:op` handler). */
  async savePage(meetingId: string, callerUserId: string, dto: SaveWhiteboardPageDto) {
    await this.permissions.requireCapability(meetingId, callerUserId, "whiteboard.edit");
    const whiteboard = await this.getOrCreate(meetingId, callerUserId);

    return this.prisma.client.whiteboardPage.upsert({
      where: { whiteboardId_index: { whiteboardId: whiteboard.id, index: dto.pageIndex } },
      create: { whiteboardId: whiteboard.id, index: dto.pageIndex, data: dto.data as object },
      update: { data: dto.data as object },
    });
  }

  async addPage(meetingId: string, callerUserId: string) {
    await this.permissions.requireCapability(meetingId, callerUserId, "whiteboard.edit");
    const whiteboard = await this.getOrCreate(meetingId, callerUserId);
    const nextIndex = whiteboard.pages.length;
    return this.prisma.client.whiteboardPage.create({
      data: { whiteboardId: whiteboard.id, index: nextIndex, data: {} },
    });
  }
}
