import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { handlePrismaError, sendValidationError } from "../lib/api-validation.js";

const router = Router();

const pageSlugSchema = z.enum([
  "chi-siamo",
  "contatti",
  "assistenza",
  "lavora-con-noi",
  "privacy-policy",
  "cookie",
]);

const pageSchema = z
  .object({
    title: z.string().trim().min(2).max(160).optional(),
    subtitle: z.string().trim().max(240).nullable().optional(),
    body: z.string().trim().min(1).max(100_000).optional(),
    seoTitle: z.string().trim().max(180).nullable().optional(),
    seoDescription: z.string().trim().max(320).nullable().optional(),
    published: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0).max(999).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Specificare almeno un campo da aggiornare",
  });

router.get("/pages", async (_req, res) => {
  const data = await prisma.staticPageContent.findMany({
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });

  return res.json({ data });
});

router.get("/pages/:slug", async (req, res) => {
  const parsed = pageSlugSchema.safeParse(req.params.slug);
  if (!parsed.success) return sendValidationError(res, parsed.error, "Pagina non valida");

  const data = await prisma.staticPageContent.findUnique({
    where: { slug: parsed.data },
  });

  if (!data) return res.status(404).json({ error: "Pagina non trovata" });
  return res.json({ data });
});

router.patch("/pages/:slug", async (req, res) => {
  const slug = pageSlugSchema.safeParse(req.params.slug);
  const parsed = pageSchema.safeParse(req.body);

  if (!slug.success) return sendValidationError(res, slug.error, "Pagina non valida");
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const data = await prisma.staticPageContent.update({
      where: { slug: slug.data },
      data: {
        ...parsed.data,
        updatedBy: res.locals.auth?.email ?? res.locals.auth?.sub ?? null,
      },
    });

    return res.json({ data });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

export default router;
