// Guard server-side: envuelve auth() con las reglas de `acceso.ts`.
// Úsalo en Server Components (páginas) y para derivar el alcance en actions.
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { calcularAlcance, puedeAccederRuta, type Alcance } from "./acceso";

/**
 * Zona EFECTIVA del usuario. Para los roles asignados a un plantel (Jefe de Planta,
 * Dosificador) la fuente de verdad es la zona de ESE plantel (así el Jefe de Planta
 * ve toda su zona sin depender de que User.zona esté seteado). Para el resto, la
 * zona directa del usuario (User.zona).
 */
async function zonaEfectiva(
  zonaUsuario: string | null,
  plantelAsignadoId: number | null,
): Promise<string | null> {
  if (plantelAsignadoId != null) {
    const pl = await prisma.planteles.findUnique({
      where: { id: plantelAsignadoId },
      select: { zona: true },
    });
    if (pl) return pl.zona;
  }
  return zonaUsuario;
}

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

/**
 * Construye el Alcance a partir del usuario de sesión, cargando de BD lo que no vive
 * en el token: los planteles del Jefe de Planta (M2M) y la zona efectiva. Para el
 * Jefe de Planta la zona se deriva de SUS planteles asignados; para el Dosificador,
 * de su plantel asignado; para el resto, User.zona.
 */
async function construirAlcance(user: {
  id: string;
  roles?: string[];
  zona?: string | null;
  plantelAsignadoId?: number | null;
  plantaAsignadaId?: number | null;
}): Promise<Alcance> {
  const roles = user.roles ?? [];
  let plantelesAsignados: number[] = [];
  let zona: string | null;

  if (roles.includes("JefePlanta")) {
    const filas = await prisma.jefes_planta_planteles.findMany({
      where: { usuario_id: user.id },
      select: { plantel: { select: { id: true, zona: true } } },
    });
    plantelesAsignados = filas.map((f) => f.plantel.id);
    // Zona del Jefe de Planta = la de sus planteles (si es única). Alimenta /programa
    // y la validación de mixer por zona; el filtro principal va por el conjunto de
    // planteles. Si no tiene planteles aún, conserva su User.zona.
    const zonas = [...new Set(filas.map((f) => f.plantel.zona))];
    zona = zonas.length === 1 ? zonas[0] : (user.zona ?? zonas[0] ?? null);
  } else {
    zona = await zonaEfectiva(user.zona ?? null, user.plantelAsignadoId ?? null);
  }

  return calcularAlcance(
    roles,
    zona,
    user.plantelAsignadoId ?? null,
    user.plantaAsignadaId ?? null,
    plantelesAsignados,
  );
}

/** Alcance del usuario logueado, o null si no hay sesión. */
export async function alcanceActual(): Promise<Alcance | null> {
  const sesion = await auth();
  if (!sesion?.user) return null;
  return construirAlcance({
    id: sesion.user.id,
    roles: sesion.user.roles ?? [],
    zona: sesion.user.zona ?? null,
    plantelAsignadoId: sesion.user.plantelAsignadoId ?? null,
    plantaAsignadaId: sesion.user.plantaAsignadaId ?? null,
  });
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
  return construirAlcance({
    id: sesion.user.id,
    roles,
    zona: sesion.user.zona ?? null,
    plantelAsignadoId: sesion.user.plantelAsignadoId ?? null,
    plantaAsignadaId: sesion.user.plantaAsignadaId ?? null,
  });
}
