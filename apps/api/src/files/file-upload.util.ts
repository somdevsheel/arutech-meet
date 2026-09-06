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
  "text/csv",
  "text/html",
  "application/json",
  "application/xml",
  "text/xml",
  "application/sql",
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

/** Fallback for a deliberately narrow set of plain-text code/data formats
 * that real browsers frequently DON'T recognize at all — a `.py`, `.ipynb`,
 * or `.sql` file's `File.type` in JS is empty string or a generic
 * `application/octet-stream` on many OS/browser combinations, since these
 * extensions usually aren't registered in the OS's own MIME database the
 * browser reads from. There's no reliable MIME signal to allowlist for
 * them, so `isAllowedUpload` falls back to the file's extension for exactly
 * this set. None of these are executable on their own the way `.exe`/`.sh`/
 * `.js` are (still excluded everywhere) — opening one does nothing unless
 * the recipient separately chooses to run it through an interpreter/tool,
 * so extension-based trust is an acceptable line to draw here. Keep this
 * list narrow and additive, same as ALLOWED_MIME_TYPES above. */
export const ALLOWED_EXTENSIONS = new Set([
  "py",
  "ipynb",
  "sql",
  "md",
  "xml",
  // Redundant with an ALLOWED_MIME_TYPES entry on browsers that DO report
  // these correctly — kept as a fallback for the ones that don't.
  "html",
  "htm",
  "csv",
  "json",
  "txt",
]);

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx === -1 ? "" : fileName.slice(idx + 1).toLowerCase();
}

/** The actual upload gate — a browser-reported MIME type matching
 * ALLOWED_MIME_TYPES (ignoring any `;parameter=...` suffix — Chrome's
 * `MediaRecorder` reports `audio/webm;codecs=opus`, not bare `audio/webm`,
 * so a strict `Set.has()` on the raw string would reject every voice
 * message a real browser records) OR the file's extension matching
 * ALLOWED_EXTENSIONS (see that constant's own comment for why MIME alone
 * isn't reliable for several legitimate formats). Either signal alone is
 * sufficient — most files satisfy both. */
export function isAllowedUpload(mimeType: string, fileName: string): boolean {
  const base = (mimeType.split(";")[0] ?? "").trim();
  if (ALLOWED_MIME_TYPES.has(base)) return true;
  return ALLOWED_EXTENSIONS.has(getExtension(fileName));
}

/** Sanitizes a user-supplied filename down to characters safe in an S3 key and
 * a Content-Disposition header — strips path separators and anything outside
 * a conservative allowlist rather than trying to blocklist every dangerous
 * character. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || "file";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "file";
}
