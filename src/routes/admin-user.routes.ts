import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  handlePrismaError,
  paginationSchema,
  sendValidationError,
  uuidSchema,
} from "../lib/api-validation.js";

const router = Router();

const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(100).nullable().optional(),
  role: z.enum(["USER", "EDITOR", "ADMIN"]).optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "Specificare almeno un campo da aggiornare",
);

router.get("/", async (req, res) => {
  const query = paginationSchema.extend({
    role: z.enum(["USER", "EDITOR", "ADMIN"]).optional(),
  }).safeParse(req.query);
  if (!query.success) return sendValidationError(res, query.error, "Filtri non validi");

  const { page, limit, search, role } = query.data;
  const where = {
    ...(search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" as const } },
            { name: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(role ? { role } : {}),
  };

  const [data, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.get("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return sendValidationError(res, id.error);

  const user = await prisma.user.findUnique({
    where: { id: id.data },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) return res.status(404).json({ error: "Utente non trovato" });
  return res.json({ data: user });
});

router.patch("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  const parsed = updateUserSchema.safeParse(req.body);
  if (!id.success) return sendValidationError(res, id.error);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  if (id.data === res.locals.auth.sub && parsed.data.role && parsed.data.role !== "ADMIN") {
    return res.status(409).json({
      error: "Non puoi rimuovere il ruolo amministratore dal tuo account",
    });
  }

  try {
    const user = await prisma.user.update({
      where: { id: id.data },
      data: parsed.data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return res.json({ data: user });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.delete("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return sendValidationError(res, id.error);

  if (id.data === res.locals.auth.sub) {
    return res.status(409).json({ error: "Non puoi eliminare il tuo account" });
  }

  try {
    await prisma.user.delete({ where: { id: id.data } });
    return res.status(204).send();
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

export default router;
