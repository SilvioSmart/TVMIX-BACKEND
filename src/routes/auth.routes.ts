import { Router } from "express";
import bcrypt from "bcrypt";
import jwt, { type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.middleware.js";

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
  const user = await prisma.user.create({
    data: { email, passwordHash, name },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
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
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    accessToken: createAccessToken(user),
    tokenType: "Bearer",
  });
});

router.get("/me", requireAuth, async (_req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: res.locals.auth.sub },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  if (!user) {
    return res.status(401).json({ error: "Utente non trovato" });
  }

  return res.json({ user });
});

export default router;
