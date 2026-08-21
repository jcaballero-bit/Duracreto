// Quién estuvo a cargo de cada planta el día del reporte de calidad: el DOSIFICADOR
// que operó cada planta y el LABORATORISTA que controló su salida.
//
// El reporte los imprime al pie para que el documento diga, sin buscar en otra
// pantalla, quién dosificó y quién muestreó. Son lecturas de BD puras (sin sesión):
// el control de acceso lo hace la página que las llama.

import { prisma } from "@/lib/prisma";
import { inicioDelDia, finDelDia } from "@/lib/motor/tiempos";

/** Nombre presentable de un usuario (nombre, o correo si no tiene nombre). */
function nombreDe(u: { name: string | null; email: string | null } | null | undefined): string | null {
  return u?.name?.trim() || u?.email?.trim() || null;
}

/**
 * Dosificador(es) de cada planta ese día: la reasignación temporal del día si existe
 * y, si no, su planta predeterminada (la misma regla que `resolverPlantaDosificador`,
 * pero mirada al revés: de la planta a la persona). Devuelve `plantaId → nombres`.
 */
export async function dosificadoresPorPlanta(dia: Date): Promise<Map<number, string[]>> {
  const [dosificadores, reasignaciones] = await Promise.all([
    prisma.user.findMany({
      where: { activo: true, roles: { some: { rol: "Dosificador" } } },
      select: { id: true, name: true, email: true, planta_predeterminada_id: true },
    }),
    prisma.reasignaciones_dosificador_planta.findMany({
      where: { fecha: { gte: inicioDelDia(dia), lt: finDelDia(dia) } },
      select: { dosificador_id: true, planta_id: true },
    }),
  ]);

  const reasignadaDe = new Map(reasignaciones.map((r) => [r.dosificador_id, r.planta_id]));
  const porPlanta = new Map<number, string[]>();
  for (const d of dosificadores) {
    const plantaId = reasignadaDe.get(d.id) ?? d.planta_predeterminada_id;
    if (plantaId == null) continue;
    const nombre = nombreDe(d);
    if (!nombre) continue;
    porPlanta.set(plantaId, [...(porPlanta.get(plantaId) ?? []), nombre]);
  }
  for (const [k, v] of porPlanta) porPlanta.set(k, v.sort((a, b) => a.localeCompare(b)));
  return porPlanta;
}

/**
 * Laboratorista asignado a la SALIDA de cada planta ese día (control de calidad en
 * planta), con la observación que le dejó su jefe. Devuelve `plantaId → datos`.
 */
export async function laboratoristasPorPlanta(
  dia: Date,
): Promise<Map<number, { nombre: string; observaciones: string }>> {
  const filas = await prisma.asignaciones_laboratorista_planta.findMany({
    where: { fecha: { gte: inicioDelDia(dia), lt: finDelDia(dia) } },
    select: {
      planta_id: true,
      observaciones: true,
      laboratorista: { select: { name: true, email: true } },
    },
  });
  const mapa = new Map<number, { nombre: string; observaciones: string }>();
  for (const f of filas) {
    const nombre = nombreDe(f.laboratorista);
    if (!nombre) continue;
    mapa.set(f.planta_id, { nombre, observaciones: f.observaciones ?? "" });
  }
  return mapa;
}

/**
 * Dónde se tomaron las muestras de un programa, a partir de lo que marcaron los
 * laboratoristas viaje por viaje: "En planta", "En obra (proyecto)", "En planta y en
 * obra" o null si todavía nadie marcó ninguna.
 */
export function ubicacionDeMuestras(
  viajes: { control_calidad?: { muestra_planta: boolean; muestra_obra: boolean } | null }[],
): string | null {
  const planta = viajes.some((v) => v.control_calidad?.muestra_planta);
  const obra = viajes.some((v) => v.control_calidad?.muestra_obra);
  if (planta && obra) return "En planta y en obra (proyecto)";
  if (planta) return "En planta";
  if (obra) return "En obra (proyecto)";
  return null;
}

/** Etiqueta de la columna "Muestra" de un viaje. */
export function textoMuestraViaje(
  cc: { muestra_planta: boolean; muestra_obra: boolean } | null | undefined,
): string {
  if (!cc) return "—";
  if (cc.muestra_planta && cc.muestra_obra) return "Planta y obra";
  if (cc.muestra_planta) return "Planta";
  if (cc.muestra_obra) return "Obra";
  return "—";
}
