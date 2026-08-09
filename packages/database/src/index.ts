import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __arutechPrisma: PrismaClient | undefined;
}

/**
 * Singleton Prisma client. In dev, Next.js/ts-node hot reload can otherwise
 * spawn a new PrismaClient (and a new connection pool) per reload; caching it
 * on `globalThis` avoids exhausting Postgres connections.
 */
export const prisma =
  global.__arutechPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__arutechPrisma = prisma;
}

export * from "@prisma/client";
