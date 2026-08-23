-- CreateEnum
CREATE TYPE "StudyMaterialStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'STUDY_MATERIAL';

-- CreateTable
CREATE TABLE "classroom_study_materials" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "transcript_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "status" "StudyMaterialStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "lecture_notes" TEXT NOT NULL,
    "study_guide" TEXT NOT NULL,
    "flashcards" JSONB NOT NULL,
    "practice_questions" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "classroom_study_materials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "classroom_study_materials_class_id_idx" ON "classroom_study_materials"("class_id");

-- AddForeignKey
ALTER TABLE "classroom_study_materials" ADD CONSTRAINT "classroom_study_materials_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_study_materials" ADD CONSTRAINT "classroom_study_materials_transcript_id_fkey" FOREIGN KEY ("transcript_id") REFERENCES "meeting_transcripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_study_materials" ADD CONSTRAINT "classroom_study_materials_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
