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
// SEGURIDAD: NO hay contraseña por defecto. Debes definir ADMIN_PASSWORD (>=8) en
// el entorno; si no, el script se niega a correr. El admin creado nace con la marca
// de "cambiar contraseña en el primer ingreso". Nunca se imprime la contraseña.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config"; // tsx no lee .env solo
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const email = (process.env.ADMIN_EMAIL ?? "admin@duracreto.com").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD ?? "";
const nombre = process.env.ADMIN_NAME ?? "Administrador";

async function main() {
  // Sin contraseña explícita NO se crea nada (evita credenciales por defecto en
  // producción, con el repositorio público).
  if (password.length < 8) {
    console.error(
      "❌ Define ADMIN_PASSWORD (mínimo 8 caracteres) en el entorno antes de correr este script.\n" +
        '   Ej.: $env:ADMIN_PASSWORD="ClaveFuerteUnica"; npm run db:admin',
    );
    process.exit(1);
  }

  // Aviso: no sembrar contra la base LOCAL por error.
  const url = process.env.DATABASE_URL ?? "(default local :5433)";
  const host = url.includes("@") ? url.split("@")[1]?.split("/")[0] : url;
  console.log(`→ Base de datos destino: ${host}`);

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    // Al (re)crear se exige cambiar la contraseña en el primer ingreso.
    update: { passwordHash, activo: true, name: nombre, debe_cambiar_password: true },
    create: { name: nombre, email, passwordHash, activo: true, debe_cambiar_password: true },
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
  console.log("   Contraseña: (la que definiste en ADMIN_PASSWORD)");
  console.log("\n⚠️  Se te pedirá cambiarla en el primer ingreso.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Error creando el admin:", e);
    process.exit(1);
  });
