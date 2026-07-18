import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { Upload } from "@aws-sdk/lib-storage";
import { Router } from "express";
import { Client as FtpClient } from "basic-ftp";
import { z } from "zod";
import type { RouteConfig as RouteConfigRecord } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { handlePrismaError, sendValidationError, uuidSchema } from "../lib/api-validation.js";
import { r2, r2Config, r2Key, sanitizeR2FileName, verifyOriginalObject } from "../lib/r2.js";
import { mediaContentTypeForFile, registerCompletedOriginal } from "../lib/loading-media.js";

const router = Router();

const protocols = ["SSH", "SFTP", "FTP", "RSYNC", "SSHFS", "LOCAL", "SMB", "NFS"] as const;
const authModes = ["KEY", "PASSWORD", "AGENT", "MOUNT", "NONE"] as const;

const routeConfigSchema = z.object({
  name: z.string().trim().min(2).max(80),
  protocol: z.enum(protocols),
  connectionUrl: z.string().trim().max(1500).optional().or(z.literal("")),
  host: z.string().trim().max(255).nullable().optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  username: z.string().trim().max(120).nullable().optional(),
  authMode: z.enum(authModes).nullable().optional(),
  passwordSecret: z.string().trim().max(500).nullable().optional(),
  remotePath: z.string().trim().max(1000).nullable().optional(),
  importPath: z.string().trim().max(1000).nullable().optional(),
  enabled: z.boolean().default(true),
  notes: z.string().trim().max(1000).nullable().optional(),
});

const routeFilesQuerySchema = z.object({
  path: z.string().trim().max(1000).optional().default(""),
});

const routeImportSchema = z.object({
  path: z.string().trim().min(1).max(1000),
});

type RouteInput = z.infer<typeof routeConfigSchema>;

function serializeRoute<T extends { passwordSecret?: string | null }>(route: T) {
  const { passwordSecret, ...safe } = route;
  return { ...safe, hasSecret: Boolean(passwordSecret) };
}

function parseConnectionUrl(connectionUrl: string) {
  const url = new URL(connectionUrl);
  const protocol = url.protocol.replace(":", "").toUpperCase();
  if (protocol !== "FTP") {
    throw new Error("Per ora l'URL automatico supporta il protocollo ftp://");
  }
  const remotePath = decodeURIComponent(url.pathname || "/");
  return {
    protocol,
    host: url.hostname,
    port: url.port ? Number(url.port) : 21,
    username: url.username ? decodeURIComponent(url.username) : null,
    passwordSecret: url.password ? decodeURIComponent(url.password) : null,
    authMode: url.password ? "PASSWORD" : "NONE",
    remotePath,
    importPath: remotePath,
  };
}

function normalizeRouteInput(input: Partial<RouteInput>, existing?: { passwordSecret?: string | null }) {
  const { connectionUrl, ...data } = input;
  const normalized: Record<string, unknown> = { ...data };

  if (connectionUrl) {
    Object.assign(normalized, parseConnectionUrl(connectionUrl));
  }

  if (!normalized.importPath) {
    normalized.importPath = normalized.remotePath || ".";
  }

  if (normalized.passwordSecret === "" || normalized.passwordSecret === undefined) {
    delete normalized.passwordSecret;
  }
  if (normalized.passwordSecret === null && existing?.passwordSecret) {
    delete normalized.passwordSecret;
  }

  return normalized;
}

function ftpPathJoin(base: string | null | undefined, relativePath: string) {
  const cleanBase = (base || "/").replace(/\/+$/g, "") || "/";
  const cleanRelative = relativePath.replace(/^\/+/g, "").replace(/\/+$/g, "");
  if (!cleanRelative) return cleanBase;
  return cleanBase === "/" ? `/${cleanRelative}` : `${cleanBase}/${cleanRelative}`;
}

function parentPath(relativePath: string) {
  const normalized = relativePath.replace(/^\/+|\/+$/g, "");
  if (!normalized) return "";
  return normalized.split("/").slice(0, -1).join("/");
}

function localImportRoot(route: Pick<RouteConfigRecord, "importPath">) {
  return path.resolve(route.importPath || process.env.MEDIA_IMPORT_ROOT || "/srv/tvmix/imports");
}

function safeLocalRoutePath(route: Pick<RouteConfigRecord, "importPath">, input: string) {
  const root = localImportRoot(route);
  const resolved = path.resolve(root, input.replace(/^[/\\]+/, ""));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Percorso fuori dalla cartella import consentita");
  }
  return resolved;
}

async function listLocalRouteFiles(route: RouteConfigRecord, inputPath: string) {
  const directory = safeLocalRoutePath(route, inputPath);
  const entries = await readdir(directory, { withFileTypes: true });
  const data = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(localImportRoot(route), absolute).split(path.sep).join("/");
    const itemStat = await stat(absolute);
    return {
      name: entry.name,
      path: relative,
      type: entry.isDirectory() ? "directory" : "file",
      size: entry.isFile() ? itemStat.size : null,
      supported: entry.isFile() ? Boolean(mediaContentTypeForFile(entry.name)) : true,
      updatedAt: itemStat.mtime.toISOString(),
    };
  }));
  return {
    root: localImportRoot(route),
    path: path.relative(localImportRoot(route), directory).split(path.sep).join("/"),
    data: data.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1),
  };
}

async function withFtpClient<T>(route: RouteConfigRecord, action: (client: FtpClient) => Promise<T>) {
  if (!route.host) throw new Error("Host FTP non configurato");
  const client = new FtpClient(30_000);
  client.ftp.verbose = false;
  try {
    await client.access({
      host: route.host,
      port: route.port ?? 21,
      user: route.username ?? "anonymous",
      password: route.passwordSecret ?? "",
      secure: false,
    });
    return await action(client);
  } finally {
    client.close();
  }
}

async function listFtpRouteFiles(route: RouteConfigRecord, inputPath: string) {
  return withFtpClient(route, async (client) => {
    const fullPath = ftpPathJoin(route.remotePath || route.importPath, inputPath);
    const entries = await client.list(fullPath);
    const baseRelative = inputPath.replace(/^\/+|\/+$/g, "");
    const data = entries.map((entry) => {
      const relative = [baseRelative, entry.name].filter(Boolean).join("/");
      return {
        name: entry.name,
        path: relative,
        type: entry.isDirectory ? "directory" : "file",
        size: entry.isFile ? entry.size : null,
        supported: entry.isFile ? Boolean(mediaContentTypeForFile(entry.name)) : true,
        updatedAt: entry.modifiedAt?.toISOString() ?? new Date().toISOString(),
      };
    });
    return {
      root: route.remotePath || route.importPath || "/",
      path: inputPath.replace(/^\/+|\/+$/g, ""),
      data: data.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1),
    };
  });
}

async function importLocalRouteFile(route: RouteConfigRecord, inputPath: string, uploadedBy?: string | null) {
  const sourcePath = safeLocalRoutePath(route, inputPath);
  const sourceStat = await stat(sourcePath);
  if (!sourceStat.isFile()) throw new Error("Il percorso selezionato non è un file");

  const fileName = path.basename(sourcePath);
  const contentType = mediaContentTypeForFile(fileName);
  if (!contentType) throw new Error("Sono ammessi solo file MP4, MOV o MKV");

  const objectKey = r2Key(`originals/${sanitizeR2FileName(fileName)}`);
  const duplicate = await prisma.video.findFirst({
    where: {
      OR: [
        { sourceObjectKey: objectKey },
        { originalFileName: fileName, processingStatus: { in: ["UPLOADED", "QUEUED", "PROCESSING", "READY"] } },
      ],
    },
    select: { id: true, title: true },
  });
  if (duplicate) throw new Error(`File già presente in archivio: ${duplicate.title}`);

  const upload = new Upload({
    client: r2,
    params: {
      Bucket: r2Config.bucket,
      Key: objectKey,
      Body: createReadStream(sourcePath),
      ContentType: contentType,
      Metadata: {
        "original-name": encodeURIComponent(fileName),
        "upload-source": "route-config",
      },
    },
    queueSize: 4,
    partSize: 64 * 1024 * 1024,
    leavePartsOnError: true,
  });
  await upload.done();
  await verifyOriginalObject(objectKey, sourceStat.size, contentType);
  return registerCompletedOriginal({ objectKey, fileName, contentType, uploadedBy });
}

async function importFtpRouteFile(route: RouteConfigRecord, inputPath: string, uploadedBy?: string | null) {
  const fileName = path.posix.basename(inputPath);
  const contentType = mediaContentTypeForFile(fileName);
  if (!contentType) throw new Error("Sono ammessi solo file MP4, MOV o MKV");

  const objectKey = r2Key(`originals/${sanitizeR2FileName(fileName)}`);
  const duplicate = await prisma.video.findFirst({
    where: {
      OR: [
        { sourceObjectKey: objectKey },
        { originalFileName: fileName, processingStatus: { in: ["UPLOADED", "QUEUED", "PROCESSING", "READY"] } },
      ],
    },
    select: { id: true, title: true },
  });
  if (duplicate) throw new Error(`File già presente in archivio: ${duplicate.title}`);

  return withFtpClient(route, async (client) => {
    const ftpFullPath = ftpPathJoin(route.remotePath || route.importPath, inputPath);
    const size = await client.size(ftpFullPath).catch(() => 0);
    const passThrough = new PassThrough();
    const upload = new Upload({
      client: r2,
      params: {
        Bucket: r2Config.bucket,
        Key: objectKey,
        Body: passThrough,
        ContentType: contentType,
        Metadata: {
          "original-name": encodeURIComponent(fileName),
          "upload-source": "ftp-route",
        },
      },
      queueSize: 4,
      partSize: 64 * 1024 * 1024,
      leavePartsOnError: true,
    });
    await Promise.all([
      client.downloadTo(passThrough, ftpFullPath),
      upload.done(),
    ]);
    if (size > 0) await verifyOriginalObject(objectKey, size, contentType);
    return registerCompletedOriginal({ objectKey, fileName, contentType, uploadedBy });
  });
}

router.get("/", async (_req, res) => {
  const data = await prisma.routeConfig.findMany({
    orderBy: [{ enabled: "desc" }, { name: "asc" }],
  });
  return res.json({ data: data.map(serializeRoute) });
});

router.post("/", async (req, res) => {
  const parsed = routeConfigSchema.strict().safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const data = await prisma.routeConfig.create({
      data: normalizeRouteInput(parsed.data) as never,
    });
    return res.status(201).json({ data: serializeRoute(data) });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    return res.status(400).json({ error: error instanceof Error ? error.message : "Configurazione rotta non valida" });
  }
});

router.get("/:id/files", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  const parsed = routeFilesQuerySchema.safeParse(req.query);
  if (!id.success) return sendValidationError(res, id.error);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const route = await prisma.routeConfig.findUniqueOrThrow({ where: { id: id.data } });
    if (!route.enabled) return res.status(400).json({ error: "Rotta disattivata" });
    const data = route.protocol === "FTP"
      ? await listFtpRouteFiles(route, parsed.data.path)
      : await listLocalRouteFiles(route, parsed.data.path);
    return res.json(data);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Lettura rotta non riuscita" });
  }
});

router.post("/:id/import", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  const parsed = routeImportSchema.strict().safeParse(req.body);
  if (!id.success) return sendValidationError(res, id.error);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const route = await prisma.routeConfig.findUniqueOrThrow({ where: { id: id.data } });
    if (!route.enabled) return res.status(400).json({ error: "Rotta disattivata" });
    const data = route.protocol === "FTP"
      ? await importFtpRouteFile(route, parsed.data.path, res.locals.auth?.email ?? null)
      : await importLocalRouteFile(route, parsed.data.path, res.locals.auth?.email ?? null);
    return res.status(201).json({ data });
  } catch (error) {
    console.error("Import da rotta fallito", error);
    return res.status(409).json({ error: error instanceof Error ? error.message : "Import da rotta non riuscito" });
  }
});

router.patch("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  const parsed = routeConfigSchema.partial().strict().refine(
    (value) => Object.keys(value).length > 0,
    "Specificare almeno un campo da aggiornare",
  ).safeParse(req.body);
  if (!id.success) return sendValidationError(res, id.error);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const existing = await prisma.routeConfig.findUnique({ where: { id: id.data }, select: { passwordSecret: true } });
    const data = await prisma.routeConfig.update({
      where: { id: id.data },
      data: normalizeRouteInput(parsed.data, existing ?? undefined) as never,
    });
    return res.json({ data: serializeRoute(data) });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    return res.status(400).json({ error: error instanceof Error ? error.message : "Aggiornamento rotta non riuscito" });
  }
});

router.delete("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return sendValidationError(res, id.error);

  try {
    await prisma.routeConfig.delete({ where: { id: id.data } });
    return res.status(204).send();
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

export default router;
