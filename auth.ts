import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import authConfig from "./auth.config";

// Campos propios que guardamos en el JWT (evita depender de la augmentación).
type DatosToken = {
  uid?: string;
  roles?: string[];
  zona?: string | null;
  nombre?: string | null;
  debeCambiar?: boolean;
  plantelAsignado?: number | null;
  revalMs?: number; // última revalidación contra la BD (epoch ms)
};

// Cada cuánto se revalida el usuario contra la BD (revocación de sesión). Un valor
// pequeño reescribiría la cookie en cada request (causa carreras en móvil); 30 s da
// revocación casi inmediata sin ese costo.
const REVAL_INTERVALO_MS = 30_000;

// Google solo se habilita si hay credenciales en el entorno (env-gated).
const googleHabilitado =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Correo", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credenciales) {
        const email = String(credenciales?.email ?? "").toLowerCase().trim();
        const password = String(credenciales?.password ?? "");
        if (!email || !password) return null;

        const usuario = await prisma.user.findUnique({ where: { email } });
        if (!usuario || !usuario.activo || !usuario.passwordHash) return null;

        const ok = await bcrypt.compare(password, usuario.passwordHash);
        if (!ok) return null;

        return { id: usuario.id, name: usuario.name, email: usuario.email };
      },
    }),
    ...(googleHabilitado ? [Google] : []),
  ],
  callbacks: {
    // El callback `session` (puro) viene de authConfig (edge-safe, compartido con
    // el middleware). Aquí solo el `jwt`, que sí lee la BD (runtime Node).
    ...authConfig.callbacks,
    // Revalida el usuario contra la BD (con throttle) para revocar la sesión si fue
    // eliminado/desactivado, y refrescar roles/zona sin re-login.
    //  · SOLO se devuelve null (revoca) cuando la BD CONFIRMA que el usuario ya no
    //    existe o está inactivo. Nunca por un token sin id ni por un error de BD:
    //    eso cerraría sesiones válidas (bug que sacaba al admin en móvil).
    async jwt({ token, user }) {
      const t = token as DatosToken;
      if (user?.id) {
        t.uid = user.id; // al iniciar sesión
        t.revalMs = 0; // fuerza la primera revalidación
      }
      const id = t.uid ?? token.sub;
      if (!id) return token; // sin id no se puede validar: NO cerrar sesión

      // Throttle: revalidar como máximo cada REVAL_INTERVALO_MS. Entre chequeos el
      // token vuelve intacto (no se reescribe la cookie en cada request).
      const ahora = Date.now();
      if (t.revalMs && ahora - t.revalMs < REVAL_INTERVALO_MS) return token;

      let dbu;
      try {
        dbu = await prisma.user.findUnique({
          where: { id },
          include: { roles: true },
        });
      } catch {
        // Error transitorio de BD: no forzar el cierre de sesión (fail-open).
        return token;
      }
      // Usuario eliminado o inactivo: sesión revocada.
      if (!dbu || !dbu.activo) return null;

      t.uid = dbu.id;
      t.roles = dbu.roles.map((r) => r.rol);
      t.zona = dbu.zona ?? null;
      t.nombre = dbu.name ?? null;
      t.debeCambiar = dbu.debe_cambiar_password ?? false;
      t.plantelAsignado = dbu.plantel_asignado_id ?? null;
      t.revalMs = ahora;
      return token;
    },
  },
});
