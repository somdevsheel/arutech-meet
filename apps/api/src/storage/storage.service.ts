import { Inject, Injectable } from "@nestjs/common";
import { S3Client, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "@arutech/config";

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

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
