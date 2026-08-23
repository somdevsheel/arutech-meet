/** Server-enforced MIME allowlist — shared by every upload path in the app
 * (chat attachments via FilesService, classroom assignments via
 * AssignmentsService). Deliberately excludes anything executable/script-like
 * (.exe, .sh, .js, archives that could smuggle either) — see docs/security.md
 * §File uploads. Extend this list rather than removing the check entirely if
 * a new legitimate type is needed. */
export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

/** Sanitizes a user-supplied filename down to characters safe in an S3 key and
 * a Content-Disposition header — strips path separators and anything outside
 * a conservative allowlist rather than trying to blocklist every dangerous
 * character. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || "file";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "file";
}
