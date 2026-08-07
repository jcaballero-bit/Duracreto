"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { exigirGestionFlota } from "@/lib/auth/guard";
import { cambiarEstadoUnidad } from "@/lib/flota/estado-unidad";

const TIPOS = ["Mixer", "Bomba", "Camion", "Pickup"];
const EVENTOS = ["Mantenimiento_Programado", "Fuera_de_Servicio", "Otro"];
const ESTADOS = ["Programado", "En_curso", "Completado", "Cancelado"];

/** "YYYY-MM-DD" → Date local a medianoche (o null si el formato es inválido). */
function diaLocal(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Programa un mantenimiento / baja de servicio de una unidad (Admin). */
export async function programarMantenimientoAction(
  unidadTipo: string,
  unidadId: number,
  inicioISO: string,
  finISO: string,
  tipoEvento: string,
  motivo: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const g = await exigirGestionFlota();
  if (!g.ok) return g;
  if (!TIPOS.includes(unidadTipo)) return { ok: false, mensaje: "Tipo de unidad no válido." };
  if (!EVENTOS.includes(tipoEvento)) return { ok: false, mensaje: "Tipo de evento no válido." };
  if (!Number.isInteger(unidadId) || unidadId <= 0) return { ok: false, mensaje: "Selecciona una unidad." };
  const ini = diaLocal(inicioISO);
  const fin = diaLocal(finISO);
  if (!ini || !fin) return { ok: false, mensaje: "Selecciona el rango de fechas en el calendario." };
  if (fin < ini) return { ok: false, mensaje: "La fecha de fin no puede ser anterior a la de inicio." };

  const sesion = await auth();
  const quien = sesion?.user?.name ?? sesion?.user?.email ?? "sistema";
  const reg = await prisma.disponibilidad_flota.create({
    data: {
      unidad_tipo: unidadTipo,
      unidad_id: unidadId,
      fecha_inicio: ini,
      fecha_fin: fin,
      tipo_evento: tipoEvento,
      motivo: motivo.trim() || null,
      estado: "Programado",
      creado_por: quien,
    },
  });
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "disponibilidad_flota",
      registro_id: reg.id,
      usuario: quien,
      campo_modificado: "alta",
      valor_anterior: null,
      valor_nuevo: `${unidadTipo} #${unidadId} del ${inicioISO} al ${finISO}`,
      motivo: tipoEvento,
    },
  });
  revalidatePath("/flota");
  return { ok: true };
}

/** Cambia el estado de un registro de mantenimiento (Iniciar/Completar/Cancelar). */
export async function cambiarEstadoMantenimientoAction(
  id: number,
  estado: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const g = await exigirGestionFlota();
  if (!g.ok) return g;
  if (!ESTADOS.includes(estado)) return { ok: false, mensaje: "Estado no válido." };
  const sesion = await auth();
  const quien = sesion?.user?.name ?? sesion?.user?.email ?? "sistema";
  const antes = await prisma.disponibilidad_flota.findUnique({ where: { id }, select: { estado: true } });
  if (!antes) return { ok: false, mensaje: "Registro no encontrado." };
  await prisma.disponibilidad_flota.update({ where: { id }, data: { estado } });
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "disponibilidad_flota",
      registro_id: id,
      usuario: quien,
      campo_modificado: "estado",
      valor_anterior: antes.estado,
      valor_nuevo: estado,
      motivo: "Cambio de estado de mantenimiento",
    },
  });
  revalidatePath("/flota");
  return { ok: true };
}

// ── Cambio RÁPIDO de estado de una unidad (día a día) + historial ────────────

/**
 * Cambio RÁPIDO de estado de una unidad (desde la fila en /flota › Equipo), sin abrir
 * el formulario completo. Registra el cambio en `historial_estado_unidad` con fecha/
 * hora para poder consultar el estado día a día. Es el estado momentáneo; una baja por
 * RANGO de días sigue programándose con `disponibilidad_flota`. Roles: gestión de flota.
 * La lógica de BD vive en `lib/flota/estado-unidad.ts` (testeable); aquí solo el guard
 * y la resolución del usuario.
 */
export async function cambiarEstadoUnidadAction(
  unidadTipo: string,
  unidadId: number,
  nuevoEstado: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const g = await exigirGestionFlota();
  if (!g.ok) return g;
  const sesion = await auth();
  const quien = sesion?.user?.name ?? sesion?.user?.email ?? "sistema";
  const res = await cambiarEstadoUnidad(unidadTipo, unidadId, nuevoEstado, quien);
  if (res.ok) revalidatePath("/flota");
  return res;
}

export interface CambioEstadoUnidad {
  fechaMs: number;
  anterior: string | null;
  nuevo: string;
  usuario: string | null;
}

/** Historial de cambios de estado de una unidad (más reciente primero). */
export async function historialEstadoUnidad(
  unidadTipo: string,
  unidadId: number,
): Promise<CambioEstadoUnidad[]> {
  const g = await exigirGestionFlota();
  if (!g.ok) return [];
  const rows = await prisma.historial_estado_unidad.findMany({
    where: { unidad_tipo: unidadTipo, unidad_id: unidadId },
    orderBy: { fecha_hora: "desc" },
    take: 100,
  });
  return rows.map((r) => ({
    fechaMs: r.fecha_hora.getTime(),
    anterior: r.estado_anterior,
    nuevo: r.estado_nuevo,
    usuario: r.usuario,
  }));
}
