import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { handlePrismaError, sendValidationError, uuidSchema } from "../lib/api-validation.js";

const router = Router();

const routeConfigSchema = z.object({
  name: z.string().trim().min(2).max(80),
  protocol: z.enum(["SSH", "SFTP", "RSYNC", "SSHFS", "LOCAL", "SMB", "NFS"]),
  host: z.string().trim().max(255).nullable().optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  username: z.string().trim().max(120).nullable().optional(),
  authMode: z.enum(["KEY", "PASSWORD", "AGENT", "MOUNT", "NONE"]).nullable().optional(),
  remotePath: z.string().trim().max(1000).nullable().optional(),
  importPath: z.string().trim().min(1).max(1000),
  enabled: z.boolean().default(true),
  notes: z.string().trim().max(1000).nullable().optional(),
});

router.get("/", async (_req, res) => {
  const data = await prisma.routeConfig.findMany({
    orderBy: [{ enabled: "desc" }, { name: "asc" }],
  });
  return res.json({ data });
});

router.post("/", async (req, res) => {
  const parsed = routeConfigSchema.strict().safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const data = await prisma.routeConfig.create({ data: parsed.data });
    return res.status(201).json({ data });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
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
    const data = await prisma.routeConfig.update({
      where: { id: id.data },
      data: parsed.data,
    });
    return res.json({ data });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
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
