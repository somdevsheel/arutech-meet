-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "organization_id" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feature_flags_key_idx" ON "feature_flags"("key");

-- CreateIndex
-- Two PARTIAL unique indexes, not one plain composite unique index: Postgres
-- treats every NULL as distinct from every other NULL in a unique constraint,
-- so a plain UNIQUE("key", "organization_id") would silently allow multiple
-- global (organization_id IS NULL) rows for the same key — exactly the case
-- that matters most (the default, no-org-override row). See FeatureFlag's
-- own schema comment.
CREATE UNIQUE INDEX "feature_flags_key_global_unique" ON "feature_flags"("key") WHERE "organization_id" IS NULL;
CREATE UNIQUE INDEX "feature_flags_key_org_unique" ON "feature_flags"("key", "organization_id") WHERE "organization_id" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
