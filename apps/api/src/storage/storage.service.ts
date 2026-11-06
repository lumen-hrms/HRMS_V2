import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import type { AppConfig } from '../config/configuration';

/**
 * Thin wrapper over any S3-compatible object store. Points at MinIO locally
 * (see docker-compose.yml); pointing S3_ENDPOINT/keys at real AWS S3 in
 * production requires no code change.
 *
 * Employee documents are stored under `tenants/<tenantId>/employees/<employeeId>/<uuid>-<filename>`
 * so that even if a bucket were ever misconfigured for public read, guessing
 * another tenant's object key is infeasible, and the API never returns raw
 * bucket contents — only short-lived presigned URLs scoped to one object.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const s3 = this.config.get('s3', { infer: true });
    this.bucket = s3.bucket;
    this.client = new S3Client({
      endpoint: s3.endpoint,
      region: s3.region,
      forcePathStyle: s3.forcePathStyle,
      credentials: { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey },
    });
  }

  async onModuleInit() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch {
        // Best-effort in dev; if MinIO isn't up yet this will surface on
        // first real upload instead of blocking API boot.
      }
    }
  }

  /**
   * `segment` sub-folders by owner (module 09 §4.2): `profile`,
   * `leave/<requestId>`, `regularization/<requestId>`. Omitted for the
   * employee photo, which predates the segmented layout.
   */
  buildKey(tenantId: string, employeeId: string, filename: string, segment?: string): string {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const prefix = `tenants/${tenantId}/employees/${employeeId}/${segment ? `${segment}/` : ''}`;
    return `${prefix}${randomUUID()}-${safeName}`;
  }

  async upload(key: string, body: Buffer, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: mimeType }),
    );
  }

  /**
   * `downloadAs` forces `Content-Disposition: attachment` on the response,
   * so a browser saves an uploaded file instead of rendering it inline on
   * the storage origin (module 09 §3.5).
   */
  async getPresignedDownloadUrl(
    key: string,
    expiresInSeconds = 300,
    downloadAs?: string,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: downloadAs
        ? `attachment; filename*=UTF-8''${encodeURIComponent(downloadAs)}`
        : undefined,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /** Whole object into memory — only used for ≤10 MB user uploads (the scan worker). */
  async download(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty body for object ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
