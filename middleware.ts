import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "./auth.config";

// Middleware edge-safe: usa solo la config base (sin Prisma) para exigir sesión.
// El callback `authorized` (auth.config) redirige a /login si no hay sesión.
export const { auth: middleware } = NextAuth(authConfig);

export default middleware((req) => {
  // Forzar cambio de contraseña en el primer ingreso: si el usuario está logueado
  // y su bandera `debeCambiarPassword` está activa, se le manda a /configuracion
  // hasta que la cambie (excepto si ya está ahí). El campo lo expone el callback
  // `session` de auth.config a partir del token.
  const user = req.auth?.user;
  const path = req.nextUrl.pathname;
  if (
    user?.debeCambiarPassword &&
    !path.startsWith("/configuracion") &&
    !path.startsWith("/login")
  ) {
    return NextResponse.redirect(new URL("/configuracion", req.nextUrl));
  }
});

export const config = {
  // Protege todo excepto la API de auth, los estáticos de Next, el favicon y los
  // archivos estáticos de /public (imágenes como el logo). Sin excluir imágenes,
  // el logo del login se redirigía a /login por no haber sesión.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|woff|woff2|ttf|webmanifest)).*)",
  ],
};
