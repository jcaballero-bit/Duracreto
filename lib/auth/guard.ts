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

/** Gestión COMPLETA de la flota (ver todo + editar todo): Administrador, Jefe de
 *  Planta, Despachador y Programador. El Dosificador NO (solo Operadores). */
export async function exigirGestionFlota(): Promise<
  { ok: true; userId: string } | { ok: false; mensaje: string }
> {
  const sesion = await auth();
  if (!sesion?.user) return { ok: false, mensaje: "Sesión no válida." };
  const a = calcularAlcance(sesion.user.roles ?? [], null);
  if (a.esAdmin || a.esJefePlanta || a.esDespachador || a.esProgramador) {
    return { ok: true, userId: sesion.user.id };
  }
  return { ok: false, mensaje: "No tienes permiso para gestionar la flota." };
}

/** Alcance del usuario logueado, o null si no hay sesión. */
export async function alcanceActual(): Promise<Alcance | null> {
  const sesion = await auth();
  if (!sesion?.user) return null;
  return calcularAlcance(
    sesion.user.roles ?? [],
    sesion.user.zona ?? null,
    sesion.user.plantelAsignadoId ?? null,
    sesion.user.plantaAsignadaId ?? null,
  );
}

/**
 * Si el usuario debe cambiar su contraseña (primer ingreso), lo manda a
 * /configuracion. Enforcement server-side (Node) — confiable, a diferencia del
 * middleware edge. La propia /configuracion NO llama a este guard, así que no hay
 * bucle. Llamar al inicio de cada página protegida (requerirAcceso ya lo hace).
 */
export async function requerirPasswordAlDia(): Promise<void> {
  const sesion = await auth();
  if (sesion?.user?.debeCambiarPassword) redirect("/configuracion");
}

/**
 * Exige que el usuario pueda acceder a `ruta`. Si no hay sesión → /login;
 * si debe cambiar contraseña → /configuracion; si no tiene el rol → vuelve al
 * panel. Devuelve el alcance para usarlo en la página (p. ej. filtrar por zona).
 */
export async function requerirAcceso(ruta: string): Promise<Alcance> {
  const sesion = await auth();
  if (!sesion?.user) redirect("/login");
  if (sesion.user.debeCambiarPassword) redirect("/configuracion");
  const roles = sesion.user.roles ?? [];
  if (!puedeAccederRuta(roles, ruta)) redirect("/?denegado=1");
  return calcularAlcance(
    roles,
    sesion.user.zona ?? null,
    sesion.user.plantelAsignadoId ?? null,
    sesion.user.plantaAsignadaId ?? null,
  );
}
