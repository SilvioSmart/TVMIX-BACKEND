import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const email = process.argv[2]?.trim().toLowerCase();

async function main(): Promise<void> {
  if (!email) {
    console.error("Uso: npm run admin:promote -- nome@dominio.it");
    process.exitCode = 1;
    return;
  }

  try {
    const user = await prisma.user.update({
      where: { email },
      data: { role: "ADMIN" },
      select: { id: true, email: true, name: true, role: true },
    });

    console.log(`Utente promosso ad ADMIN: ${user.email}`);
  } catch {
    console.error(`Utente non trovato: ${email}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
