-- Dedupe existing MeetingParticipant rows before the unique constraint below
-- can be added — a concurrent-join race (e.g. two browser tabs, no
-- transaction around the existing-participant lookup) could create more
-- than one row for the same (meeting_id, user_id) pair. Keeps the most
-- recently created row per pair (matching the same `orderBy: createdAt
-- desc` convention PermissionService.getParticipant already uses to
-- resolve "the" participant when duplicates exist), breaking a same-
-- millisecond tie by id for determinism. No-op if no duplicates exist.
DELETE FROM "meeting_participants" mp
USING "meeting_participants" newer
WHERE mp.meeting_id = newer.meeting_id
  AND mp.user_id = newer.user_id
  AND mp.user_id IS NOT NULL
  AND (mp.created_at, mp.id) < (newer.created_at, newer.id);

-- DropIndex
DROP INDEX "meeting_participants_meeting_id_user_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "meeting_participants_meeting_id_user_id_key" ON "meeting_participants"("meeting_id", "user_id");
