import { Router } from "express";
import bcrypt from "bcrypt";
import jwt, { type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  addHours,
  adminFrontendUrl,
  createAccountToken,
  hashAccountToken,
} from "../lib/account-security.js";
import {
  sendEmailVerificationMail,
  sendPasswordResetMail,
} from "../lib/account-mailer.js";

const router = Router();

const credentialsSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(12, "La password deve contenere almeno 12 caratteri")
    .max(72, "La password non può superare 72 caratteri"),
});

const registrationSchema = credentialsSchema.extend({
  name: z.string().trim().min(2).max(100).optional(),
});

const emailOnlySchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
});

const resetPasswordSchema = z.object({
  token: z.string().trim().min(20),
  password: z
    .string()
    .min(12, "La password deve contenere almeno 12 caratteri")
    .max(72, "La password non puÃ² superare 72 caratteri"),
});

function createAccessToken(user: {
  id: string;
  email: string;
  role: "USER" | "EDITOR" | "ADMIN";
}): string {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET deve contenere almeno 32 caratteri");
  }

  return jwt.sign(
    { email: user.email, role: user.role },
    secret,
    {
      subject: user.id,
      issuer: "tvmix-backend",
      audience: "tvmix.it",
      expiresIn: (process.env.JWT_EXPIRES_IN ?? "1h") as SignOptions["expiresIn"],
      algorithm: "HS256",
    },
  );
}

router.post("/register", async (req, res) => {
  const parsed = registrationSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Dati di registrazione non validi",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { email, password, name } = parsed.data;
  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    return res.status(409).json({ error: "Email già registrata" });
  }

  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
  const passwordHash = await bcrypt.hash(password, rounds);
  const verification = createAccountToken();
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      emailVerificationHash: verification.hash,
      emailVerificationExpires: addHours(24),
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      permissions: true,
      emailVerifiedAt: true,
      createdAt: true,
    },
  });
  const verificationUrl = `${adminFrontendUrl()}/verify-email?token=${verification.token}`;
  await sendEmailVerificationMail(email, verificationUrl).catch((error) => {
    console.error("Invio verifica email fallito", error);
  });

  return res.status(201).json({
    user,
    accessToken: createAccessToken(user),
    tokenType: "Bearer",
  });
});

router.post("/login", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Credenziali non valide" });
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Email o password non corrette" });
  }

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      permissions: user.permissions,
      emailVerifiedAt: user.emailVerifiedAt,
    },
    accessToken: createAccessToken(user),
    tokenType: "Bearer",
  });
});

router.get("/me", requireAuth, async (_req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: res.locals.auth.sub },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      permissions: true,
      emailVerifiedAt: true,
      createdAt: true,
    },
  });

  if (!user) {
    return res.status(401).json({ error: "Utente non trovato" });
  }

  return res.json({ user });
});

router.get("/email/verify/:token", async (req, res) => {
  const token = z.string().trim().min(20).safeParse(req.params.token);
  if (!token.success) return res.status(400).json({ error: "Token non valido" });

  const user = await prisma.user.findFirst({
    where: {
      emailVerificationHash: hashAccountToken(token.data),
      emailVerificationExpires: { gt: new Date() },
    },
  });

  if (!user) return res.status(400).json({ error: "Token scaduto o non valido" });

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      emailVerificationHash: null,
      emailVerificationExpires: null,
    },
  });

  return res.json({ status: "verified" });
});

router.post("/password-reset/request", async (req, res) => {
  const parsed = emailOnlySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Email non valida" });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (user?.emailVerifiedAt) {
    const reset = createAccountToken();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetHash: reset.hash,
        passwordResetExpires: addHours(2),
      },
    });
    const resetUrl = `${adminFrontendUrl()}/reset-password?token=${reset.token}`;
    await sendPasswordResetMail(user.email, resetUrl).catch((error) => {
      console.error("Invio recupero password fallito", error);
    });
  }

  return res.json({
    status: "ok",
    message: "Se l'email Ã¨ certificata, riceverai le istruzioni per reimpostare la password.",
  });
});

router.post("/password-reset/confirm", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Dati reset password non validi",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const user = await prisma.user.findFirst({
    where: {
      passwordResetHash: hashAccountToken(parsed.data.token),
      passwordResetExpires: { gt: new Date() },
    },
  });

  if (!user) return res.status(400).json({ error: "Token scaduto o non valido" });

  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
  const passwordHash = await bcrypt.hash(parsed.data.password, rounds);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordResetHash: null,
      passwordResetExpires: null,
    },
  });

  return res.json({ status: "password-updated" });
});

export default router;
