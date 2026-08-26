import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** The flag keys actually wired into a real, server-enforced gate today —
 * see docs/roadmap.md's Feature flags stage for why only these three (not
 * every feature in the app) were chosen to demonstrate real enforcement,
 * and where each is checked. An admin can still create/toggle a flag with
 * any other key (a real, useful thing to do — e.g. staging a flag ahead of
 * wiring its gate) — it just won't affect anything until some service
 * actually calls `isEnabled` with that key. */
export const KNOWN_FEATURE_FLAG_KEYS = ["WHITEBOARD", "BREAKOUT_ROOMS", "LIVE_CAPTIONS"] as const;

/**
 * Minimal, real feature-flag system — no new SaaS dependency, per the
 * roadmap item's own scoping. A `key` resolves through at most two rows: an
 * org-scoped override (if the caller's meeting belongs to an org and one
 * exists), else the global row for that key, else — critically — enabled by
 * default. That last part isn't a convenience default, it's a correctness
 * requirement: every feature already shipping in this app today was
 * unconditionally on before this system existed, and introducing flags must
 * never silently turn one off for a key nobody has ever configured.
 */
@Injectable()
export class FeatureFlagsService {
  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(key: string, orgId?: string | null): Promise<boolean> {
    if (orgId) {
      const override = await this.prisma.client.featureFlag.findFirst({
        where: { key, organizationId: orgId },
      });
      if (override) return override.enabled;
    }
    const global = await this.prisma.client.featureFlag.findFirst({
      where: { key, organizationId: null },
    });
    return global?.enabled ?? true;
  }

  /** Same as `isEnabled`, but resolves the org from the meeting itself —
   * every real call site (WhiteboardService, BreakoutRoomsService,
   * CaptionsService, the WS whiteboard:op handler) needs exactly this, so
   * the org lookup lives here once instead of being repeated at each one. */
  async isEnabledForMeeting(key: string, meetingId: string): Promise<boolean> {
    const meeting = await this.prisma.client.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      select: { orgId: true },
    });
    return this.isEnabled(key, meeting.orgId);
  }

  /** The resolved state of every *known* (actually-wired) flag for one
   * meeting, in one call — what the client needs to decide whether to show
   * the Whiteboard tab, the Breakout Rooms button, and the Captions control
   * at all, rather than showing a control that would just 403 on click. One
   * `orgId` lookup shared across all three checks. */
  async listKnownForMeeting(meetingId: string): Promise<Record<(typeof KNOWN_FEATURE_FLAG_KEYS)[number], boolean>> {
    const meeting = await this.prisma.client.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      select: { orgId: true },
    });
    const entries = await Promise.all(
      KNOWN_FEATURE_FLAG_KEYS.map(async (key) => [key, await this.isEnabled(key, meeting.orgId)] as const),
    );
    return Object.fromEntries(entries) as Record<(typeof KNOWN_FEATURE_FLAG_KEYS)[number], boolean>;
  }

  /** Every flag row — global defaults and every org override — for the admin
   * UI to render as one list. Small table, no pagination needed yet. */
  async listAll() {
    return this.prisma.client.featureFlag.findMany({
      include: { organization: { select: { id: true, name: true } } },
      orderBy: [{ key: "asc" }, { organizationId: "asc" }],
    });
  }

  /** No `@@unique([key, organizationId])` exists in the schema — real
   * uniqueness for this table is two partial indexes a compound-unique
   * Prisma `where` can't target (see FeatureFlag's own schema comment) — so
   * this upserts by hand: look the row up, then create or update by id.
   * Admin-only, low-traffic, no meaningful concurrent-write risk here. */
  private async upsert(key: string, organizationId: string | null, enabled: boolean, description?: string) {
    const existing = await this.prisma.client.featureFlag.findFirst({ where: { key, organizationId } });
    if (existing) {
      return this.prisma.client.featureFlag.update({
        where: { id: existing.id },
        data: { enabled, description },
      });
    }
    return this.prisma.client.featureFlag.create({
      data: { key, organizationId, enabled, description },
    });
  }

  async setGlobal(key: string, enabled: boolean, description?: string) {
    return this.upsert(key, null, enabled, description);
  }

  async setOrgOverride(key: string, orgId: string, enabled: boolean, description?: string) {
    return this.upsert(key, orgId, enabled, description);
  }

  async removeOrgOverride(key: string, orgId: string): Promise<void> {
    await this.prisma.client.featureFlag.deleteMany({ where: { key, organizationId: orgId } });
  }
}
