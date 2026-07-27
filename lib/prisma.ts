// Singleton del cliente Prisma.
//
// Fase 3: PostgreSQL (antes SQLite). Se conecta mediante el driver adapter
// @prisma/adapter-pg leyendo DATABASE_URL. Next.js carga .env automáticamente;
// los scripts fuera de Next (seed, tests) deben cargar dotenv antes de importar
// este módulo.
//
// En desarrollo Next.js recarga módulos con hot-reload; sin este singleton se
// crearían múltiples PrismaClient y se agotarían las conexiones.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function crearPrisma(): PrismaClient {
  const connectionString =
    process.env.DATABASE_URL ??
    "postgresql://duracreto:duracreto@localhost:5433/duracreto?schema=public";
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? crearPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
