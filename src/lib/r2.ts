import {
  HeadBucketCommand,
  HeadObjectCommand,
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

export function isOriginalObjectKey(objectKey: string): boolean {
  const escapedPrefix = r2Config.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefixPattern = escapedPrefix ? `${escapedPrefix}/` : "";
  return new RegExp(
    `^${prefixPattern}originals/[0-9a-f-]{36}/source\\.(mp4|mov|mkv)$`,
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
