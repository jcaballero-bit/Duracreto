import type { NextAuthConfig } from "next-auth";

// Config base EDGE-SAFE (sin Prisma/bcrypt): la usa el middleware para decidir
// acceso. Los providers y el callback `jwt` (con BD) se agregan en auth.ts.
//
// El callback `session` vive AQUÍ (es puro: solo copia token→sesión) para que
// tanto el servidor como el middleware expongan los mismos campos (roles, zona,
// debeCambiarPassword). El `jwt` (que lee la BD) sí vive en auth.ts.
export default {
  trustHost: true,
  pages: { signIn: "/login" },
  // La sesion NO caduca por inactividad (decision del usuario, sep-2026): dura hasta
  // que la persona toque "Cerrar sesion". Se probo un vencimiento de 8 h y se descarto
  // porque el personal de campo usa el sistema instalado en su celular y habria tenido
  // que iniciar sesion casi todas las mananas, mientras que el escenario que preocupaba
  // —el relevo de turno en una computadora compartida— no lo resuelve un plazo: ahi el
  // equipo esta en uso continuo y la sesion nunca vence. Lo que ese caso necesita es que
  // cerrar sesion cierre DE VERDAD, que es lo que resuelven `cerrarSesionAction` y la
  // invalidacion de la cache del navegador.
  //
  // La duracion vive AQUI y no en auth.ts porque el middleware se construye con esta
  // config: si se quisiera un vencimiento, ponerlo solo en auth.ts no tendria efecto
  // sobre el middleware (comprobado).
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    // Controla el acceso a rutas desde el middleware: exige sesión salvo /login.
    authorized({ auth, request }) {
      const enLogin = request.nextUrl.pathname.startsWith("/login");
      const logueado = !!auth?.user;
      if (enLogin) return true; // /login siempre accesible
      return logueado; // resto de rutas: redirige a signIn si no hay sesión
    },
    // Mapea los campos del token a la sesión (server y middleware).
    session({ session, token }) {
      if (session.user) {
        session.user.id = (token.uid as string | undefined) ?? "";
        session.user.roles = (token.roles as string[] | undefined) ?? [];
        session.user.zona = (token.zona as string | null | undefined) ?? null;
        session.user.debeCambiarPassword =
          (token.debeCambiar as boolean | undefined) ?? false;
        session.user.plantelAsignadoId =
          (token.plantelAsignado as number | null | undefined) ?? null;
        session.user.plantaPredeterminadaId =
          (token.plantaPredeterminada as number | null | undefined) ?? null;
        if (token.nombre) session.user.name = token.nombre as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
