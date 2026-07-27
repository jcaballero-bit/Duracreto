import NextAuth from "next-auth";
import authConfig from "./auth.config";

// Middleware edge-safe: usa solo la config base (sin Prisma) para exigir sesión.
// El callback `authorized` decide; si no hay sesión, Auth.js redirige a /login.
export const { auth: middleware } = NextAuth(authConfig);

export default middleware((req) => {
  // La lógica de acceso vive en callbacks.authorized (auth.config.ts).
  void req;
});

export const config = {
  // Protege todo excepto la API de auth, estáticos y el favicon.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
