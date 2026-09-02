import type { ZodIssue } from "zod";

/**
 * Turns a Zod issue's field path (e.g. "avatarUrl", "settings.waitingRoomEnabled")
 * into a human label ("Avatar URL", "Waiting Room Enabled") instead of the raw
 * camelCase/dotted path a client never chose and shouldn't have to see — see M-3:
 * every validation-error surface in the app (REST's ZodValidationPipe, the REST
 * AllExceptionsFilter's own ZodError branch for a raw throw that skipped the
 * pipe, and WsExceptionFilter for gateway messages) built its client-facing
 * message the same way, by joining `issue.path` verbatim, and every one of
 * those strings goes straight into a form's error banner. Only the *label* is
 * reformatted here; each schema's own validation message (already
 * human-authored for the checks that matter — see e.g. passwordSchema's
 * per-rule messages) is left untouched.
 */
function humanizeFieldPath(path: (string | number)[]): string {
  // A path can end (or consist entirely) of array indices — e.g. an issue on
  // "attendees.0.email" vs. one on the array itself, "attendees" — walk
  // backward to the last actual field name rather than showing a raw index.
  const lastField = [...path].reverse().find((segment) => typeof segment === "string");
  if (lastField === undefined) return "";

  return String(lastField)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\bUrl\b/, "URL")
    .replace(/\bId\b/, "ID");
}

/** A path-less issue (e.g. a root-level `.refine()` cross-field check, like
 * "passwords don't match") gets no label prefix — there's no single field to
 * name, and the message is already meant to stand on its own. */
export function formatZodIssues(issues: ZodIssue[]): string[] {
  return issues.map((issue) => {
    const label = humanizeFieldPath(issue.path);
    return label ? `${label}: ${issue.message}` : issue.message;
  });
}
