import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";

export const uuidSchema = z.string().uuid("ID non valido");

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
});

export const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug non valido");

export const optionalUrlSchema = z
  .union([z.string().trim().url(), z.literal(""), z.null()])
  .transform((value) => (value === "" ? null : value))
  .optional();

export const nullableDateSchema = z
  .union([z.coerce.date(), z.literal(""), z.null()])
  .transform((value) => (value === "" ? null : value))
  .optional();

export function sendValidationError(
  res: Response,
  error: z.ZodError,
  message = "Dati non validi",
) {
  return res.status(400).json({
    error: message,
    details: error.flatten().fieldErrors,
  });
}

export function handlePrismaError(res: Response, error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code === "P2002") {
    res.status(409).json({ error: "Esiste già una risorsa con questi dati" });
    return true;
  }

  if (error.code === "P2003") {
    res.status(409).json({
      error: "La risorsa è ancora collegata ad altri elementi",
    });
    return true;
  }

  if (error.code === "P2025") {
    res.status(404).json({ error: "Risorsa non trovata" });
    return true;
  }

  return false;
}
