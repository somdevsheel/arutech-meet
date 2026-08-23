-- AlterTable
ALTER TABLE "chat_members" ADD COLUMN     "is_admin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "chat_rooms" ADD COLUMN     "photo_url" TEXT;
