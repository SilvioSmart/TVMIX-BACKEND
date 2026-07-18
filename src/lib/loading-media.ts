import path from "node:path";
import { prisma } from "./prisma.js";

const contentTypes = ["video/mp4", "video/quicktime", "video/x-matroska"] as const;

const extensionContentType: Record<string, typeof contentTypes[number]> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
};

export type OriginalMediaContentType = typeof contentTypes[number];

export function mediaContentTypeForFile(fileName: string): OriginalMediaContentType | null {
  return extensionContentType[path.extname(fileName).toLowerCase()] ?? null;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || `media-${Date.now()}`;
}

export async function uniqueVideoSlug(base: string): Promise<string> {
  const normalized = slugify(base);
  let candidate = normalized;
  let suffix = 2;
  while (await prisma.video.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${normalized}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export async function loadingCategoryId(): Promise<string> {
  const category = await prisma.category.upsert({
    where: { slug: "loading" },
    create: {
      name: "Loading",
      slug: "loading",
      description: "Area tecnica per media caricati in archivio e non ancora catalogati",
    },
    update: {},
    select: { id: true },
  });
  return category.id;
}

export async function registerCompletedOriginal(input: {
  logicalUploadId?: string;
  objectKey: string;
  fileName: string;
  contentType: OriginalMediaContentType;
  uploadedBy?: string | null;
}) {
  const existingBySource = await prisma.video.findFirst({
    where: { sourceObjectKey: input.objectKey },
    include: { category: true, season: { include: { program: true } } },
  });
  if (existingBySource) return existingBySource;

  if (input.logicalUploadId) {
    const existingById = await prisma.video.findUnique({
      where: { id: input.logicalUploadId },
      include: { category: true, season: { include: { program: true } } },
    }).catch(() => null);
    if (existingById) return existingById;
  }

  const title = path.parse(input.fileName).name;
  return prisma.video.create({
    data: {
      title,
      slug: await uniqueVideoSlug(title),
      categoryId: await loadingCategoryId(),
      sourceObjectKey: input.objectKey,
      originalFileName: input.fileName,
      uploadedBy: input.uploadedBy ?? null,
      processingStatus: "UPLOADED",
      processingError: null,
      mediaFormat: input.contentType,
      published: false,
    },
    include: { category: true, season: { include: { program: true } } },
  });
}
