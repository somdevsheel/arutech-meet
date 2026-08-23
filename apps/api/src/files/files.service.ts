import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { PresignUploadDto } from "@arutech/validation";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { PermissionService } from "../meetings/permission.service";
import { ALLOWED_MIME_TYPES, sanitizeFileName } from "./file-upload.util";

/**
 * Real object-storage file uploads (chat/meeting attachments — see
 * docs/feature-gap-analysis.md §5/§27), built on the pre-existing `FileAsset`
 * schema (previously unused by any service). Upload flow: this service mints
 * a presigned PUT URL and a `FileAsset` row up front; the browser uploads
 * directly to S3/MinIO (never through this API process — see
 * StorageService's doc comment); nothing reads the file back until a chat
 * message actually references it.
 *
 * Virus scanning: `FileAsset.virusScanStatus` defaults to `PENDING` and stays
 * there — no scanner is wired up in this environment. `getDownloadUrl` only
 * blocks `INFECTED` (a status nothing here ever sets), not `PENDING`, so
 * uploads work end-to-end today rather than silently hanging forever waiting
 * for a scan that will never run. A real deployment should run a scanning
 * worker (e.g. a ClamAV sidecar consuming an upload-completed event, or a
 * cloud AV API) that flips this status before this method's guard would
 * matter — the schema and the guard are both already in place for it.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly permissions: PermissionService,
  ) {}

  async presignMeetingUpload(meetingId: string, callerUserId: string, dto: PresignUploadDto) {
    await this.permissions.requireCapability(meetingId, callerUserId, "chat.send");

    if (!ALLOWED_MIME_TYPES.has(dto.mimeType)) {
      throw new BadRequestException(`File type ${dto.mimeType} is not allowed`);
    }

    const safeName = sanitizeFileName(dto.fileName);
    const storageKey = `chat-uploads/${meetingId}/${Date.now()}-${randomUUID()}-${safeName}`;

    const file = await this.prisma.client.fileAsset.create({
      data: {
        uploaderUserId: callerUserId,
        scope: "MEETING",
        meetingId,
        storageKey,
        originalName: safeName,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        virusScanStatus: "PENDING",
      },
    });

    const uploadUrl = await this.storage.getSignedUploadUrl(storageKey, dto.mimeType);
    return { fileId: file.id, uploadUrl };
  }

  async getDownloadUrl(meetingId: string, callerUserId: string, fileId: string) {
    await this.permissions.getParticipant(meetingId, callerUserId);

    const file = await this.prisma.client.fileAsset.findUnique({ where: { id: fileId } });
    if (!file || file.meetingId !== meetingId || file.deletedAt) {
      throw new NotFoundException("File not found");
    }
    if (file.virusScanStatus === "INFECTED") {
      throw new ForbiddenException("This file failed a virus scan and cannot be downloaded");
    }

    const url = await this.storage.getSignedDownloadUrl(file.storageKey);
    return { url, fileName: file.originalName, mimeType: file.mimeType, expiresInSeconds: 600 };
  }
}
