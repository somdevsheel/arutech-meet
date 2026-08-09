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
      },
    });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async updateProfile(
    userId: string,
    data: { displayName?: string; avatarUrl?: string; timezone?: string; locale?: string },
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
