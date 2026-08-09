/**
 * Local development seed data. Not run against production databases.
 * Usage: pnpm db:seed
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await argon2.hash("Password123!");

  const owner = await prisma.user.upsert({
    where: { email: "owner@arutech.dev" },
    update: {},
    create: {
      email: "owner@arutech.dev",
      username: "owner",
      displayName: "Arutech Owner",
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });

  const guest = await prisma.user.upsert({
    where: { email: "guest@arutech.dev" },
    update: {},
    create: {
      email: "guest@arutech.dev",
      username: "guest",
      displayName: "Test Guest",
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });

  const org = await prisma.organization.upsert({
    where: { slug: "arutech-consultancy" },
    update: {},
    create: {
      name: "Arutech Consultancy Services LLP",
      slug: "arutech-consultancy",
      ownerUserId: owner.id,
      plan: "BUSINESS",
      memberships: {
        create: [
          { userId: owner.id, role: "OWNER" },
          { userId: guest.id, role: "MEMBER" },
        ],
      },
    },
  });

  console.log({ owner: owner.email, guest: guest.email, org: org.slug });
  console.log("Seed complete. Login with owner@arutech.dev / Password123!");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
