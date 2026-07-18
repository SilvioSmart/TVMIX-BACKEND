import type { Response } from "express";
import type { AuthTokenPayload } from "../middleware/auth.middleware.js";
import { prisma } from "./prisma.js";

export async function currentUserDisplayName(res: Response): Promise<string | null> {
  const auth = res.locals.auth as AuthTokenPayload | undefined;
  if (!auth?.sub) return auth?.email ?? null;

  const user = await prisma.user.findUnique({
    where: { id: auth.sub },
    select: { name: true, email: true },
  }).catch(() => null);

  return user?.name || user?.email || auth.email || null;
}
