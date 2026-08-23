import { Inject, Injectable } from "@nestjs/common";
import { S3Client, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "@arutech/config";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import type { Readable } from "stream";

/**
 * The ONLY place the API talks to object storage directly. Clients never receive
 * S3/MinIO credentials — they get a short-lived signed URL minted here (see
 * docs/security.md §File uploads). MinIO is API-compatible with S3, so this same
 * client works against both by pointing `S3_ENDPOINT` at either.
 */
@Injectable()
export class StorageService {
  /** Used for server-to-server calls (delete) — resolves on the API's own network
   * (e.g. the internal Docker hostname in local dev). */
  private readonly client: S3Client;
  /** Used only to compute presigned URLs — must use a host the requesting
   * browser can actually resolve. Signing is a local HMAC computation, no network
   * call happens against this client, so it's safe to point it at a different
   * (public) endpoint than `client` even though both target the same bucket. */
  private readonly publicClient: S3Client;
  private readonly bucket: string;

  constructor(@Inject("ENV") private readonly env: Env) {
    this.bucket = env.S3_BUCKET;
    const credentials = { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY };
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials,
    });
    this.publicClient = new S3Client({
      // `||` (not `??`) deliberately: an S3_PUBLIC_ENDPOINT set to an empty
      // string in a .env file is indistinguishable from "unset" and should fall
      // back the same way `undefined` does.
      endpoint: env.S3_PUBLIC_ENDPOINT || env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials,
    });
  }

  get s3Config() {
    return {
      accessKey: this.env.S3_ACCESS_KEY,
      secret: this.env.S3_SECRET_KEY,
      region: this.env.S3_REGION,
      endpoint: this.env.S3_ENDPOINT,
      bucket: this.bucket,
      forcePathStyle: this.env.S3_FORCE_PATH_STYLE,
    };
  }

  async getSignedDownloadUrl(key: string, expiresInSeconds = 600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.publicClient, command, { expiresIn: expiresInSeconds });
  }

  /** Presigned PUT for direct browser-to-storage uploads (chat/file attachments
   * — see apps/api/src/files) — the client never gets S3 credentials, just a
   * one-time write URL for exactly this key. Signed against `publicClient`
   * (browser-reachable endpoint), same reasoning as `getSignedDownloadUrl`.
   * Note: a presigned PUT alone can't enforce `Content-Length` server-side (S3
   * presigned-POST with policy conditions can, at the cost of a form-upload API
   * instead of a plain PUT) — the declared `sizeBytes` is checked before this
   * URL is minted (see FilesService.presignUpload), not enforced against what
   * actually gets uploaded. Acceptable for this app's trust model (authenticated
   * meeting participants only) but worth knowing if this key is ever reused for
   * untrusted/anonymous uploads. */
  async getSignedUploadUrl(key: string, contentType: string, expiresInSeconds = 300): Promise<string> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    return getSignedUrl(this.publicClient, command, { expiresIn: expiresInSeconds });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Server-side fetch of an object's bytes to a local file — used by the AI
   * transcription pipeline (apps/api/src/ai) to feed a recording into ffmpeg.
   * Deliberately the only other place besides `deleteObject` that reads/writes
   * object storage directly on the server; every client-facing path still only
   * ever gets a signed URL, never these credentials. Uses `client` (internal
   * network), not `publicClient`, matching `deleteObject` above. */
  async downloadToFile(key: string, destPath: string): Promise<void> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = result.Body as Readable | undefined;
    if (!body) throw new Error(`Object ${key} has no readable body`);
    await pipeline(body, createWriteStream(destPath));
  }
}
