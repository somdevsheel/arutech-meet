import { customAlphabet } from "nanoid";

// Lowercase letters minus visually-ambiguous ones (no `l`, `o`, `i`) + digits minus `0`,`1`.
const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
const segment = customAlphabet(alphabet, 4);

/** Generates a Meet-style join code, e.g. "abcd-efgh-jkmn". */
export function generateMeetingCode(): string {
  return `${segment()}-${segment()}-${segment()}`;
}

/** Generates the internal LiveKit room name for a meeting (must be unique, URL-safe). */
export function generateLiveKitRoomName(meetingCode: string): string {
  return `meeting-${meetingCode}`;
}
