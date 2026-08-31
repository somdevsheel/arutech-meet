-- Backfills existing User.email values to lowercase, matching the new
-- normalize-at-validation invariant (registerSchema/loginSchema/
-- requestPasswordResetSchema now trim+lowercase email before it ever
-- reaches the database) — without this, an account created before this
-- migration with a mixed-case email would still be unreachable by the
-- now-always-lowercase login lookup.
--
-- Guarded with NOT EXISTS rather than a bare UPDATE: if two existing rows
-- already differ only by case (itself only reachable because of the exact
-- case-sensitivity bug this migration closes), lowercasing both would
-- collide on the unique index and fail outright. No such collision exists
-- in any environment this has been run against so far (checked directly),
-- but a migration that can hard-fail an entire deploy over a handful of
-- accounts is worse than leaving that handful's case untouched — those
-- would need manual review (merge or rename) rather than a silent
-- migration-time decision.
UPDATE "users" AS u
SET email = LOWER(u.email)
WHERE u.email <> LOWER(u.email)
  AND NOT EXISTS (
    SELECT 1 FROM "users" AS other
    WHERE other.id <> u.id AND LOWER(other.email) = LOWER(u.email)
  );
