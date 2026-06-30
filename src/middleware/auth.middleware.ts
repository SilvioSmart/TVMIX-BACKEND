import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";

export type AuthTokenPayload = JwtPayload & {
  email: string;
  role: "USER" | "EDITOR" | "ADMIN";
};

type UserRole = AuthTokenPayload["role"];

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  const secret = process.env.JWT_SECRET;

  if (!token || !secret) {
    return res.status(401).json({ error: "Autenticazione richiesta" });
  }

  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: "tvmix-backend",
      audience: "tvmix.it",
    }) as AuthTokenPayload;

    if (!payload.sub || !payload.email || !payload.role) {
      return res.status(401).json({ error: "Token non valido" });
    }

    res.locals.auth = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "Sessione scaduta o non valida" });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const auth = res.locals.auth as AuthTokenPayload | undefined;

    if (!auth) {
      return res.status(401).json({ error: "Autenticazione richiesta" });
    }

    if (!roles.includes(auth.role)) {
      return res.status(403).json({ error: "Permessi insufficienti" });
    }

    return next();
  };
}
