// Guard server-side: envuelve auth() con las reglas de `acceso.ts`.
// Úsalo en Server Components (páginas) y para derivar el alcance en actions.
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { calcularAlcance, puedeAccederRuta, type Alcance } from "./acceso";

/** Para server actions de Administración: exige Administrador sin redirigir. */
export async function exigirAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; mensaje: string }
> {
  const sesion = await auth();
  if (!sesion?.user) return { ok: false, mensaje: "Sesión no válida." };
  const alcance = calcularAlcance(sesion.user.roles ?? [], null);
  if (!alcance.esAdmin) {
    return { ok: false, mensaje: "Solo un Administrador puede hacer esto." };
  }
  return { ok: true, userId: sesion.user.id };
}

/** Alcance del usuario logueado, o null si no hay sesión. */
export async function alcanceActual(): Promise<Alcance | null> {
  const sesion = await auth();
  if (!sesion?.user) return null;
  return calcularAlcance(sesion.user.roles ?? [], sesion.user.zona ?? null);
}

/**
 * Exige que el usuario pueda acceder a `ruta`. Si no hay sesión → /login;
 * si no tiene el rol → vuelve al panel. Devuelve el alcance para usarlo en la
 * página (p. ej. para filtrar por zona).
 */
export async function requerirAcceso(ruta: string): Promise<Alcance> {
  const sesion = await auth();
  if (!sesion?.user) redirect("/login");
  const roles = sesion.user.roles ?? [];
  if (!puedeAccederRuta(roles, ruta)) redirect("/?denegado=1");
  return calcularAlcance(roles, sesion.user.zona ?? null);
}
