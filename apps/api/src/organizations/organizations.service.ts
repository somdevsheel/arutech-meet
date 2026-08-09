import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "org"
  );
}

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, name: string) {
    const baseSlug = slugify(name);
    let slug = baseSlug;
    let suffix = 1;
    while (await this.prisma.client.organization.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${++suffix}`;
    }

    return this.prisma.client.organization.create({
      data: {
        name,
        slug,
        ownerUserId: userId,
        memberships: { create: { userId, role: "OWNER" } },
      },
    });
  }

  async listMine(userId: string) {
    return this.prisma.client.organization.findMany({
      where: { deletedAt: null, memberships: { some: { userId } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(id: string, userId: string) {
    const org = await this.prisma.client.organization.findUnique({
      where: { id },
      include: { memberships: { where: { userId } } },
    });
    if (!org || org.deletedAt) throw new NotFoundException("Organization not found");
    if (org.memberships.length === 0) throw new ForbiddenException("Not a member of this organization");
    return org;
  }

  async addMember(orgId: string, actingUserId: string, targetUserId: string, role: "ADMIN" | "MEMBER") {
    const membership = await this.prisma.client.membership.findUnique({
      where: { orgId_userId: { orgId, userId: actingUserId } },
    });
    if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
      throw new ForbiddenException("Only org owners/admins can add members");
    }
    const existing = await this.prisma.client.membership.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    if (existing) throw new ConflictException("User is already a member");

    return this.prisma.client.membership.create({
      data: { orgId, userId: targetUserId, role, invitedByUserId: actingUserId },
    });
  }
}
