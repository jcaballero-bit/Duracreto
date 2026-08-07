// Cambio rápido de estado de una unidad (mixer/bomba/camión/pickup) + registro en
// `historial_estado_unidad`. Módulo puro-de-BD (sin "use server") para poder probarlo
// en aislamiento; la server action de /flota lo envuelve con el guard y el usuario.
import { prisma } from "@/lib/prisma";
import { ESTADOS_UNIDAD } from "./estados";

const TIPOS = new Set(["Mixer", "Bomba", "Camion", "Pickup"]);

/** Estado actual de una unidad según su tipo (o null si no existe / tipo inválido). */
async function estadoActual(tipo: string, id: number): Promise<string | null> {
  const sel = { where: { id }, select: { estado: true } } as const;
  switch (tipo) {
    case "Mixer":
      return (await prisma.mixers.findUnique(sel))?.estado ?? null;
    case "Bomba":
      return (await prisma.bombas.findUnique(sel))?.estado ?? null;
    case "Camion":
      return (await prisma.camiones.findUnique(sel))?.estado ?? null;
    case "Pickup":
      return (await prisma.pickups.findUnique(sel))?.estado ?? null;
    default:
      return null;
  }
}

/** Escribe el nuevo estado de la unidad según su tipo. */
async function actualizar(tipo: string, id: number, estado: string): Promise<void> {
  const arg = { where: { id }, data: { estado } } as const;
  switch (tipo) {
    case "Mixer":
      await prisma.mixers.update(arg);
      break;
    case "Bomba":
      await prisma.bombas.update(arg);
      break;
    case "Camion":
      await prisma.camiones.update(arg);
      break;
    case "Pickup":
      await prisma.pickups.update(arg);
      break;
  }
}

/**
 * Cambia el estado momentáneo de una unidad y registra el cambio (con fecha/hora) en
 * `historial_estado_unidad`. Devuelve ok/mensaje. No hace autorización ni resuelve el
 * usuario (eso lo hace la server action que lo llama).
 */
export async function cambiarEstadoUnidad(
  unidadTipo: string,
  unidadId: number,
  nuevoEstado: string,
  usuario: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  if (!TIPOS.has(unidadTipo)) return { ok: false, mensaje: "Tipo de unidad no válido." };
  if (!(ESTADOS_UNIDAD as readonly string[]).includes(nuevoEstado)) {
    return { ok: false, mensaje: "Estado no válido." };
  }
  const anterior = await estadoActual(unidadTipo, unidadId);
  if (anterior == null) return { ok: false, mensaje: "Unidad no encontrada." };
  if (anterior === nuevoEstado) return { ok: true }; // sin cambio real
  await actualizar(unidadTipo, unidadId, nuevoEstado);
  await prisma.historial_estado_unidad.create({
    data: {
      unidad_tipo: unidadTipo,
      unidad_id: unidadId,
      estado_anterior: anterior,
      estado_nuevo: nuevoEstado,
      usuario,
    },
  });
  return { ok: true };
}
