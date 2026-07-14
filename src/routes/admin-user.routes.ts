import { Router } from "express";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  handlePrismaError,
  paginationSchema,
  sendValidationError,
  uuidSchema,
} from "../lib/api-validation.js";
import {
  addHours,
  adminFrontendUrl,
  createAccountToken,
} from "../lib/account-security.js";
import {
  sendEmailVerificationMail,
  sendPasswordResetMail,
} from "../lib/account-mailer.js";

const router = Router();

const userPermissions = [
  "CONTENT_VIEW",
  "CONTENT_MANAGE",
  "CATALOG_MANAGE",
  "LIVE_MANAGE",
  "APPEARANCE_MANAGE",
  "USERS_MANAGE",
  "SETTINGS_MANAGE",
  "HLS_MANAGE",
  "VAST_MANAGE",
] as const;

const defaultPermissionsByRole = {
  USER: ["CONTENT_VIEW"],
  EDITOR: [
    "CONTENT_VIEW",
    "CONTENT_MANAGE",
    "CATALOG_MANAGE",
    "LIVE_MANAGE",
    "APPEARANCE_MANAGE",
    "HLS_MANAGE",
    "VAST_MANAGE",
  ],
  ADMIN: [...userPermissions],
} satisfies Record<"USER" | "EDITOR" | "ADMIN", typeof userPermissions[number][]>;

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  permissions: true,
  emailVerifiedAt: true,
  emailVerificationExpires: true,
  passwordResetExpires: true,
  createdAt: true,
  updatedAt: true,
} as const;

const passwordSchema = z
  .string()
  .min(12, "La password deve contenere almeno 12 caratteri")
  .max(72, "La password non puÃ² superare 72 caratteri");

const createUserSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  name: z.string().trim().min(2).max(100).nullable().optional(),
  role: z.enum(["USER", "EDITOR", "ADMIN"]).default("USER"),
  permissions: z.array(z.enum(userPermissions)).optional(),
  password: passwordSchema.optional(),
  emailVerified: z.boolean().default(false),
  sendVerificationEmail: z.boolean().default(true),
}).strict();

const updateUserSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()).optional(),
  name: z.string().trim().min(2).max(100).nullable().optional(),
  role: z.enum(["USER", "EDITOR", "ADMIN"]).optional(),
  permissions: z.array(z.enum(userPermissions)).optional(),
  password: passwordSchema.optional(),
  emailVerified: z.boolean().optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "Specificare almeno un campo da aggiornare",
);

function verificationUrl(token: string): string {
  return `${adminFrontendUrl()}/verify-email?token=${token}`;
}

function passwordResetUrl(token: string): string {
  return `${adminFrontendUrl()}/reset-password?token=${token}`;
}

async function ensureAnotherAdmin(targetUserId: string) {
  const adminCount = await prisma.user.count({
    where: { role: "ADMIN", id: { not: targetUserId } },
  });
  return adminCount > 0;
}

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
        ...userSelect,
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

router.get("/permissions", (_req, res) => {
  return res.json({
    data: userPermissions.map((key) => ({
      key,
      label: {
        CONTENT_VIEW: "Visualizzare contenuti",
        CONTENT_MANAGE: "Gestire contenuti",
        CATALOG_MANAGE: "Gestire catalogo",
        LIVE_MANAGE: "Gestire dirette e EPG",
        APPEARANCE_MANAGE: "Gestire aspetto e moduli",
        USERS_MANAGE: "Gestire utenti",
        SETTINGS_MANAGE: "Gestire impostazioni",
        HLS_MANAGE: "Avviare conversioni HLS",
        VAST_MANAGE: "Gestire VAST advertising",
      }[key],
    })),
    defaults: defaultPermissionsByRole,
  });
});

router.get("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return sendValidationError(res, id.error);

  const user = await prisma.user.findUnique({
    where: { id: id.data },
    select: {
      ...userSelect,
    },
  });

  if (!user) return res.status(404).json({ error: "Utente non trovato" });
  return res.json({ data: user });
});

router.post("/", async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
  const temporaryPassword = parsed.data.password ?? `TVMIX-${randomUUID()}!Aa1`;
  const passwordHash = await bcrypt.hash(temporaryPassword, rounds);
  const verification = parsed.data.emailVerified ? null : createAccountToken();
  const permissions = parsed.data.permissions ?? defaultPermissionsByRole[parsed.data.role];

  try {
    const user = await prisma.user.create({
      data: {
        email: parsed.data.email,
        name: parsed.data.name ?? null,
        role: parsed.data.role,
        permissions,
        passwordHash,
        emailVerifiedAt: parsed.data.emailVerified ? new Date() : null,
        emailVerificationHash: verification?.hash,
        emailVerificationExpires: verification ? addHours(24) : null,
      },
      select: userSelect,
    });

    let emailVerificationUrl: string | null = null;
    if (verification && parsed.data.sendVerificationEmail) {
      emailVerificationUrl = verificationUrl(verification.token);
      await sendEmailVerificationMail(user.email, emailVerificationUrl).catch((error) => {
        console.error("Invio verifica email fallito", error);
      });
    }

    return res.status(201).json({
      data: user,
      ...(parsed.data.password ? {} : { temporaryPassword }),
      ...(emailVerificationUrl ? { emailVerificationUrl } : {}),
    });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
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

  if (
    id.data === res.locals.auth.sub &&
    parsed.data.permissions &&
    !parsed.data.permissions.includes("USERS_MANAGE")
  ) {
    return res.status(409).json({
      error: "Non puoi rimuovere il permesso di gestione utenti dal tuo account",
    });
  }

  if (parsed.data.role && parsed.data.role !== "ADMIN" && !(await ensureAnotherAdmin(id.data))) {
    return res.status(409).json({ error: "Deve rimanere almeno un amministratore" });
  }

  const { password, emailVerified, ...rest } = parsed.data;
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);

  try {
    const user = await prisma.user.update({
      where: { id: id.data },
      data: {
        ...rest,
        ...(password ? { passwordHash: await bcrypt.hash(password, rounds) } : {}),
        ...(emailVerified === true
          ? {
              emailVerifiedAt: new Date(),
              emailVerificationHash: null,
              emailVerificationExpires: null,
            }
          : {}),
        ...(emailVerified === false
          ? {
              emailVerifiedAt: null,
            }
          : {}),
      },
      select: userSelect,
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

  if (!(await ensureAnotherAdmin(id.data))) {
    return res.status(409).json({ error: "Deve rimanere almeno un amministratore" });
  }

  try {
    await prisma.user.delete({ where: { id: id.data } });
    return res.status(204).send();
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.post("/:id/send-verification", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return sendValidationError(res, id.error);

  const verification = createAccountToken();
  const user = await prisma.user.update({
    where: { id: id.data },
    data: {
      emailVerifiedAt: null,
      emailVerificationHash: verification.hash,
      emailVerificationExpires: addHours(24),
    },
    select: userSelect,
  }).catch((error) => {
    if (handlePrismaError(res, error)) return null;
    throw error;
  });

  if (!user) return;

  const url = verificationUrl(verification.token);
  await sendEmailVerificationMail(user.email, url).catch((error) => {
    console.error("Invio verifica email fallito", error);
  });

  return res.json({ data: user, emailVerificationUrl: url });
});

router.post("/:id/password-reset-link", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return sendValidationError(res, id.error);

  const reset = createAccountToken();
  const user = await prisma.user.update({
    where: { id: id.data },
    data: {
      passwordResetHash: reset.hash,
      passwordResetExpires: addHours(2),
    },
    select: userSelect,
  }).catch((error) => {
    if (handlePrismaError(res, error)) return null;
    throw error;
  });

  if (!user) return;

  const url = passwordResetUrl(reset.token);
  await sendPasswordResetMail(user.email, url).catch((error) => {
    console.error("Invio recupero password fallito", error);
  });

  return res.json({ data: user, passwordResetUrl: url });
});

export default router;
