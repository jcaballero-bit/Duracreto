// ─────────────────────────────────────────────────────────────────────────────
// Crea (o restablece) UN usuario administrador — apto para PRODUCCIÓN.
//
// A diferencia de prisma/seed.ts, este script NO levanta el Postgres embebido ni
// siembra datos de demostración: solo asegura un admin para poder entrar. Escribe
// en la base que indique DATABASE_URL (p. ej. la de Neon en producción).
//
// Uso (PowerShell), apuntando a la base de producción:
//   $env:DATABASE_URL="postgresql://...neon...?sslmode=require"; `
//   $env:ADMIN_EMAIL="tucorreo@duracreto.com"; $env:ADMIN_PASSWORD="TuClaveFuerte"; `
//   npm run db:admin
//
// Si no defines ADMIN_EMAIL/ADMIN_PASSWORD, usa los valores por defecto de abajo
// (cámbialos apenas entres, desde Administración › Usuarios).
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config"; // tsx no lee .env solo
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const email = (process.env.ADMIN_EMAIL ?? "admin@duracreto.com").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD ?? "Duracreto.2026";
const nombre = process.env.ADMIN_NAME ?? "Administrador";

async function main() {
  // Aviso: no sembrar contra la base LOCAL por error.
  const url = process.env.DATABASE_URL ?? "(default local :5433)";
  const host = url.includes("@") ? url.split("@")[1]?.split("/")[0] : url;
  console.log(`→ Base de datos destino: ${host}`);

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, activo: true, name: nombre },
    // El admin de arranque elige su propia contraseña → no se fuerza el cambio.
    create: { name: nombre, email, passwordHash, activo: true, debe_cambiar_password: false },
  });

  // Asegurar el rol Administrador (idempotente: @@unique(userId, rol)).
  const yaEsAdmin = await prisma.userRole.findFirst({
    where: { userId: user.id, rol: "Administrador" },
  });
  if (!yaEsAdmin) {
    await prisma.userRole.create({ data: { userId: user.id, rol: "Administrador" } });
  }

  console.log("\n✅ Administrador listo. Inicia sesión con:");
  console.log(`   Correo:     ${email}`);
  console.log(`   Contraseña: ${password}`);
  console.log("\n⚠️  Cámbiala apenas entres (Administración › Usuarios).");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Error creando el admin:", e);
    process.exit(1);
  });
