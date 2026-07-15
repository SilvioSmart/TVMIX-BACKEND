import {
  DeleteObjectsCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variabile ambiente mancante: ${name}`);
  return value;
}

function positiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Variabile ambiente non valida: ${name}`);
  }
  return value;
}

export const r2 = new S3Client({
  region: "auto",
  endpoint: required("R2_ENDPOINT"),
  credentials: {
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
  },
});

export const r2Config = {
  bucket: required("R2_BUCKET"),
  prefix: (process.env.R2_PREFIX ?? "tvmix-media").trim().replace(/^\/+|\/+$/g, ""),
  publicUrl: required("R2_PUBLIC_URL").replace(/\/$/, ""),
  uploadUrlExpiresIn: positiveNumber("R2_UPLOAD_URL_EXPIRES_IN", 900),
  maxUploadBytes: positiveNumber("R2_MAX_UPLOAD_BYTES", 10_737_418_240),
};

export function r2Key(path: string): string {
  const normalizedPath = path.replace(/^\/+/, "");
  return r2Config.prefix
    ? `${r2Config.prefix}/${normalizedPath}`
    : normalizedPath;
}

export function sanitizeR2FileName(fileName: string): string {
  const cleaned = fileName
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || `upload-${Date.now()}`;
}

export function isOriginalObjectKey(objectKey: string): boolean {
  const escapedPrefix = r2Config.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefixPattern = escapedPrefix ? `${escapedPrefix}/` : "";
  return new RegExp(
    `^${prefixPattern}originals/[^/]+\\.(mp4|mov|mkv)$`,
  ).test(objectKey);
}

export async function verifyR2Bucket(): Promise<void> {
  await r2.send(new HeadBucketCommand({ Bucket: r2Config.bucket }));
}

export async function verifyOriginalObject(
  objectKey: string,
  expectedSize: number,
  expectedContentType: string,
): Promise<void> {
  const object = await r2.send(
    new HeadObjectCommand({
      Bucket: r2Config.bucket,
      Key: objectKey,
    }),
  );

  if (object.ContentLength !== expectedSize) {
    throw new Error("La dimensione del file caricato non corrisponde");
  }

  if (object.ContentType !== expectedContentType) {
    throw new Error("Il tipo del file caricato non corrisponde");
  }
}

export async function verifyR2Object(
  objectKey: string,
  expectedSize: number,
  expectedContentType: string,
): Promise<void> {
  const object = await r2.send(
    new HeadObjectCommand({
      Bucket: r2Config.bucket,
      Key: objectKey,
    }),
  );

  if (object.ContentLength !== expectedSize) {
    throw new Error("La dimensione del file caricato non corrisponde");
  }

  if (object.ContentType !== expectedContentType) {
    throw new Error("Il tipo del file caricato non corrisponde");
  }
}

export function objectKeyFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const publicPrefix = `${r2Config.publicUrl}/`;
  if (!url.startsWith(publicPrefix)) return null;
  return decodeURIComponent(url.slice(publicPrefix.length));
}

export function uniqueObjectKeys(keys: Array<string | null | undefined>): string[] {
  return [...new Set(keys.filter((key): key is string => Boolean(key)))];
}

export async function deleteR2Objects(keys: string[]): Promise<{ deleted: number; errors: string[] }> {
  const uniqueKeys = uniqueObjectKeys(keys);
  const errors: string[] = [];
  let deleted = 0;

  for (let index = 0; index < uniqueKeys.length; index += 1000) {
    const batch = uniqueKeys.slice(index, index + 1000);
    const result = await r2.send(new DeleteObjectsCommand({
      Bucket: r2Config.bucket,
      Delete: {
        Quiet: true,
        Objects: batch.map((Key) => ({ Key })),
      },
    }));
    deleted += batch.length - (result.Errors?.length ?? 0);
    for (const error of result.Errors ?? []) {
      errors.push(`${error.Key ?? "unknown"}: ${error.Code ?? "DeleteError"}`);
    }
  }

  return { deleted, errors };
}

export async function listR2KeysByPrefix(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let ContinuationToken: string | undefined;

  do {
    const result = await r2.send(new ListObjectsV2Command({
      Bucket: r2Config.bucket,
      Prefix: prefix,
      ContinuationToken,
    }));
    for (const item of result.Contents ?? []) {
      if (item.Key) keys.push(item.Key);
    }
    ContinuationToken = result.NextContinuationToken;
  } while (ContinuationToken);

  return keys;
}

export async function deleteR2Prefix(prefix: string): Promise<{ deleted: number; errors: string[] }> {
  const keys = await listR2KeysByPrefix(prefix);
  return deleteR2Objects(keys);
}
