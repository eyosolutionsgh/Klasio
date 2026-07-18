/**
 * Object storage behind an interface (docs/04 §4.3), for student photos, student documents
 * and bank-deposit proofs.
 *
 * Two adapters:
 *  - **S3** (`@aws-sdk/client-s3`) — also speaks MinIO/any S3-compatible endpoint via
 *    STORAGE_S3_ENDPOINT + path-style addressing.
 *  - **Local disk** — used when S3 env vars are absent, so dev and air-gapped standalone
 *    boxes (docs/03 §3.1 shape 3) work with no bucket at all. Same fallback shape as the SMS
 *    and payment adapters.
 *
 * Deliberately no presigned URLs: these are children's photos and documents, so every read
 * goes through an authenticated API route that checks the caller's school. A presigned URL is
 * a long-lived bearer token for child data that we cannot revoke once it leaks.
 */
import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join, normalize, resolve, sep } from 'path';

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
}

export interface StorageProvider {
  readonly kind: 'S3' | 'LOCAL';
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** Allowed upload types, kept tight — these are public-facing upload endpoints. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const DOCUMENT_TYPES = [...IMAGE_TYPES, 'application/pdf'];
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Build a tenant-scoped object key. The schoolId prefix keeps one school's files in their own
 * namespace, and the random suffix stops a guessed key from resolving.
 */
export function objectKey(schoolId: string, kind: string, id: string, filename: string): string {
  const ext = (filename.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `schools/${schoolId}/${kind}/${id}/${randomUUID()}.${ext || 'bin'}`;
}

export function checksum(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 32);
}

class LocalDiskProvider implements StorageProvider {
  readonly kind = 'LOCAL' as const;
  private root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Resolve a key under the root, refusing anything that escapes it (path traversal). */
  private pathFor(key: string): string {
    const full = resolve(join(this.root, normalize(key)));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error('Invalid storage key');
    }
    return full;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return { key, size: body.length, contentType };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

class S3Provider implements StorageProvider {
  readonly kind = 'S3' as const;
  // Typed loosely so the SDK is only required when S3 is actually configured.
  private client: {
    send: (cmd: unknown) => Promise<{ Body?: { transformToByteArray(): Promise<Uint8Array> } }>;
  };
  private cmds: Record<string, new (input: unknown) => unknown>;

  constructor(
    private bucket: string,
    config: { region: string; endpoint?: string; accessKeyId?: string; secretAccessKey?: string },
  ) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const s3 = require('@aws-sdk/client-s3');
    this.cmds = s3;
    this.client = new s3.S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
      ...(config.accessKeyId && config.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const PutObjectCommand = this.cmds.PutObjectCommand;
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return { key, size: body.length, contentType };
  }

  async get(key: string): Promise<Buffer> {
    const GetObjectCommand = this.cmds.GetObjectCommand;
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Object not found: ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    const DeleteObjectCommand = this.cmds.DeleteObjectCommand;
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let cached: StorageProvider | undefined;

/**
 * S3 when a bucket is configured, local disk otherwise. Resolved once and reused.
 */
export function storage(): StorageProvider {
  if (cached) return cached;
  const bucket = process.env.STORAGE_S3_BUCKET;
  if (bucket) {
    cached = new S3Provider(bucket, {
      region: process.env.STORAGE_S3_REGION ?? 'us-east-1',
      endpoint: process.env.STORAGE_S3_ENDPOINT,
      accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY,
    });
  } else {
    cached = new LocalDiskProvider(process.env.STORAGE_LOCAL_DIR ?? './storage');
  }
  return cached;
}

/** Test seam — drops the memoised provider so env changes take effect. */
export function resetStorage(): void {
  cached = undefined;
}
