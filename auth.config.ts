import type { NextAuthConfig } from "next-auth";

// Config base EDGE-SAFE (sin Prisma/bcrypt): la usa el middleware para decidir
// acceso. Los providers y callbacks con BD se agregan en auth.ts (runtime Node).
export default {
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    // Controla el acceso a rutas desde el middleware: exige sesión salvo /login.
    authorized({ auth, request }) {
      const enLogin = request.nextUrl.pathname.startsWith("/login");
      const logueado = !!auth?.user;
      if (enLogin) return true; // /login siempre accesible
      return logueado; // resto de rutas: redirige a signIn si no hay sesión
    },
  },
} satisfies NextAuthConfig;
