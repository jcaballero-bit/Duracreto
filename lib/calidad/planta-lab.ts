// El LABORATORISTA DE PLANTA: qué plantas tiene asignadas hoy y qué puede hacer.
//
// Es un papel distinto del laboratorista de obra. El de obra sigue a un PROYECTO
// (`asignaciones_laboratorista`, por pedido) y marca Llegada / Descargando /
// Regresando. El de planta está en la BÁSCULA (`asignaciones_laboratorista_planta`,
// por planta y día): ve los mixers que cargan en SU planta, les toma revenimiento y
// temperatura de salida y solo despacha el camión — marca **En ruta**, nada más.

import { prisma } from "@/lib/prisma";
import { inicioDelDia, finDelDia } from "@/lib/motor/tiempos";

/** Único estado que puede marcar el laboratorista de planta: el mixer sale cargado. */
export const ESTADO_LABORATORISTA_PLANTA = "En ruta" as const;

/** Plantas asignadas a este laboratorista ese día (vacío = no es lab de planta hoy). */
export async function plantasDelLaboratorista(userId: string, dia: Date): Promise<number[]> {
  if (!userId) return [];
  const filas = await prisma.asignaciones_laboratorista_planta.findMany({
    where: {
      laboratorista_id: userId,
      fecha: { gte: inicioDelDia(dia), lt: finDelDia(dia) },
    },
    select: { planta_id: true },
  });
  return [...new Set(filas.map((f) => f.planta_id))];
}

/**
 * `where` de pedidos para que el laboratorista de planta VEA los viajes que cargan en
 * sus plantas. Se combina con el filtro de sus proyectos de obra: un laboratorista
 * puede tener las dos cosas el mismo día (está en la planta y además le asignaron un
 * proyecto), y debe ver ambas.
 */
export function filtroPedidoPorPlantasDelLab(plantaIds: number[]) {
  return { viajes: { some: { planta_id: { in: plantaIds } } } };
}

/** ¿Este viaje carga en una de las plantas que el laboratorista tiene asignadas hoy? */
export async function viajeEsDeSuPlanta(
  viajeId: number,
  userId: string,
  dia: Date,
): Promise<boolean> {
  const plantas = await plantasDelLaboratorista(userId, dia);
  if (plantas.length === 0) return false;
  const v = await prisma.viajes.findUnique({
    where: { id: viajeId },
    select: { planta_id: true },
  });
  return v?.planta_id != null && plantas.includes(v.planta_id);
}
