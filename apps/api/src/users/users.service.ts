import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findPublicProfile(userId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        username: true,
        avatarUrl: true,
        timezone: true,
        locale: true,
        createdAt: true,
        lastSeenAt: true,
      },
    });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async updateProfile(
    userId: string,
    data: { displayName?: string; avatarUrl?: string | null; timezone?: string; locale?: string },
  ) {
    return this.prisma.client.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        displayName: true,
        username: true,
        avatarUrl: true,
        timezone: true,
        locale: true,
      },
    });
  }

  /** Used by class-enrollment UI (a teacher enters a student's email to find their
   * userId) — deliberately returns only public-profile fields, same as findPublicProfile. */
  async findByEmail(email: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { email },
      select: { id: true, displayName: true, username: true, avatarUrl: true },
    });
    if (!user) throw new NotFoundException("No user with that email");
    return user;
  }

  /** L-1: `currentSessionId` (the caller's own Session id, from their access
   * token — see JwtAuthGuard) marks which listed row is "this device", so
   * the client can render every OTHER row with a real revoke control
   * instead of the read-only list this used to be. */
  async listSessions(userId: string, currentSessionId?: string) {
    const sessions = await this.prisma.client.session.findMany({
      where: { userId, revokedAt: null },
      select: {
        id: true,
        userAgent: true,
        ip: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
      orderBy: { lastUsedAt: "desc" },
    });
    return sessions.map((s) => ({ ...s, current: s.id === currentSessionId }));
  }

  /** L-1: the actual fix — Active Sessions was purely read-only before this.
   * Deliberately refuses to revoke the caller's OWN current session here:
   * doing so would invalidate the very session making this request (their
   * next call would need a refresh that itself then fails, since the
   * session backing it is now revoked) — Settings' existing Sign Out button
   * is the correct, already-working way to end your own current session. */
  async revokeSession(userId: string, sessionId: string, currentSessionId?: string): Promise<void> {
    if (sessionId === currentSessionId) {
      throw new BadRequestException("Use Sign out to end your own current session");
    }
    const session = await this.prisma.client.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new NotFoundException("Session not found");
    }
    await this.prisma.client.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }
}
