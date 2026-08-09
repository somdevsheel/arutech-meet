/**
 * Mirrors the Prisma enums in packages/database/prisma/schema.prisma but as plain
 * string-literal unions so packages that must NOT depend on @prisma/client (e.g.
 * apps/web, apps/mobile) can still share these types. Keep in sync with the schema.
 */

export const ORG_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PARTICIPANT_ROLES = [
  "OWNER",
  "HOST",
  "CO_HOST",
  "TEACHER",
  "STUDENT",
  "PARTICIPANT",
  "GUEST",
] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const SYSTEM_ROLES = ["USER", "ADMIN"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];
