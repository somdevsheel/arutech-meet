import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateNoteDto, UpdateNoteDto } from "@arutech/validation";
import { PrismaService } from "../prisma/prisma.service";

/** Personal notes — always private to their owner (no sharing/collaboration
 * model here, unlike the meeting-scoped whiteboard/chat). Optionally linked to
 * a meeting purely for the reader's own context ("notes from this call"), not
 * for access control. */
@Injectable()
export class NotesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.client.note.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
    });
  }

  async get(userId: string, noteId: string) {
    const note = await this.prisma.client.note.findUnique({ where: { id: noteId } });
    if (!note || note.deletedAt) throw new NotFoundException("Note not found");
    if (note.userId !== userId) throw new ForbiddenException("Not your note");
    return note;
  }

  create(userId: string, dto: CreateNoteDto) {
    return this.prisma.client.note.create({
      data: { userId, title: dto.title, body: dto.body ?? "", meetingId: dto.meetingId },
    });
  }

  async update(userId: string, noteId: string, dto: UpdateNoteDto) {
    await this.get(userId, noteId); // ownership check
    return this.prisma.client.note.update({
      where: { id: noteId },
      data: { title: dto.title, body: dto.body, meetingId: dto.meetingId },
    });
  }

  async remove(userId: string, noteId: string) {
    await this.get(userId, noteId); // ownership check
    await this.prisma.client.note.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
  }
}
