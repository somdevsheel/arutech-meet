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
  // Voice messages (recorded client-side via MediaRecorder — see
  // docs/roadmap.md's chat-parity stage). audio/webm is what Chrome/Firefox's
  // MediaRecorder actually produces by default; the others cover Safari
  // (mp4/aac) and a generic ogg/opus fallback.
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
  "audio/mpeg",
]);

/** Checks a browser-reported MIME type against the allowlist above, ignoring
 * any `;parameter=...` suffix. Real-world browsers append these — Chrome's
 * `MediaRecorder` reports `audio/webm;codecs=opus`, not bare `audio/webm` —
 * so a strict `Set.has()` on the raw string rejects every voice message a
 * real browser records. The suffix is still stored verbatim on the
 * `FileAsset` (and sent as the upload's Content-Type) since it's genuinely
 * useful codec information for playback; only the allowlist check strips it. */
export function isAllowedMimeType(mimeType: string): boolean {
  const base = (mimeType.split(";")[0] ?? "").trim();
  return ALLOWED_MIME_TYPES.has(base);
}

/** Sanitizes a user-supplied filename down to characters safe in an S3 key and
 * a Content-Disposition header — strips path separators and anything outside
 * a conservative allowlist rather than trying to blocklist every dangerous
 * character. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || "file";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "file";
}
