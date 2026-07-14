import { createHash, randomBytes } from "node:crypto";

export function createAccountToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashAccountToken(token) };
}

export function hashAccountToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function addHours(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export function publicFrontendUrl(): string {
  return (process.env.FRONTEND_URL ?? "https://www.tvmix.it").replace(/\/$/, "");
}

export function adminFrontendUrl(): string {
  return (process.env.ADMIN_FRONTEND_URL ?? "https://api.tvmix.it").replace(/\/$/, "");
}

