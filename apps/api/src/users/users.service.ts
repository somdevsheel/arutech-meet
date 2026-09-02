import { Injectable, NotFoundException } from "@nestjs/common";
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

  async listSessions(userId: string) {
    return this.prisma.client.session.findMany({
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
  }
}
