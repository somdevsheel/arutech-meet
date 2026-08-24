-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "forwarded_from_sender_name" TEXT;

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "chat_room_id" TEXT;

-- CreateIndex
CREATE INDEX "files_chat_room_id_idx" ON "files"("chat_room_id");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_chat_room_id_fkey" FOREIGN KEY ("chat_room_id") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
