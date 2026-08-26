"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  ETIQUETA_PUESTO_SINGULAR,
  PUESTOS_MOTORISTA_MIXER,
  PUESTOS_OPERADOR_BOMBA,
  type Puesto,
} from "@/lib/planilla/puestos";
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

/**
 * Asigna (o quita) el MIXER habitual de un operador. FUENTE ÚNICA de la relación
 * operador↔mixer: la columna `mixers.operador_asignado_id` (NO se guarda un
 * mixer_id en operadores). Por eso, para asignar el mixer M al operador O:
 *  1) se limpia O de cualquier OTRO mixer que lo tuviera (un operador = un mixer habitual),
 *  2) se pone O en el mixer M.
 * `mixerId = null` deja al operador sin mixer habitual. El motor luego pre-llena el
 * motorista del viaje leyendo `mixer.operador_asignado_id` (editable en despacho).
 */
export async function asignarMixerOperadorAction(
  operadorId: number,
  mixerId: number | null,
): Promise<{ ok: boolean; mensaje?: string }> {
  const g = await exigirGestionFlota();
  if (!g.ok) return g;
  if (!Number.isInteger(operadorId) || operadorId <= 0) {
    return { ok: false, mensaje: "Operador no válido." };
  }

  const operador = await prisma.operadores.findUnique({
    where: { id: operadorId },
    select: { nombre: true, puesto: true },
  });
  if (!operador) return { ok: false, mensaje: "Operador no encontrado." };

  // La tabla `operadores` guarda a todo el personal operativo, y el motor copia este
  // motorista habitual al viaje del mixer: un dosificador o un operador de cargadora
  // no puede quedar aquí (si no, saldría como motorista del viaje).
  if (
    mixerId != null &&
    !(PUESTOS_MOTORISTA_MIXER as string[]).includes(operador.puesto)
  ) {
    return {
      ok: false,
      mensaje: `${operador.nombre} tiene el puesto "${ETIQUETA_PUESTO_SINGULAR[operador.puesto as Puesto] ?? operador.puesto}": no puede ser el motorista habitual de un mixer.`,
    };
  }

  // Si se asigna un mixer, validar que exista y que su motorista actual sea otro
  // (evita marcar como "ya asignado a otro" desde la UI y guardar igual por API).
  if (mixerId != null) {
    const m = await prisma.mixers.findUnique({
      where: { id: mixerId },
      select: { operador_asignado_id: true },
    });
    if (!m) return { ok: false, mensaje: "Mixer no encontrado." };
    if (m.operador_asignado_id != null && m.operador_asignado_id !== operadorId) {
      return {
        ok: false,
        mensaje: "Ese mixer ya tiene otro motorista habitual. Quítaselo primero.",
      };
    }
  }

  const sesion = await auth();
  const quien = sesion?.user?.name ?? sesion?.user?.email ?? "sistema";

  try {
    await prisma.$transaction(async (tx) => {
      // 1) Limpiar a este operador de cualquier mixer previo (menos el nuevo).
      await tx.mixers.updateMany({
        where: { operador_asignado_id: operadorId, ...(mixerId != null ? { id: { not: mixerId } } : {}) },
        data: { operador_asignado_id: null },
      });
      // 2) Fijar el nuevo mixer (si hay).
      if (mixerId != null) {
        await tx.mixers.update({
          where: { id: mixerId },
          data: { operador_asignado_id: operadorId },
        });
      }
    });

    await prisma.bitacora_auditoria.create({
      data: {
        tabla_afectada: "mixers",
        registro_id: mixerId ?? 0,
        usuario: quien,
        campo_modificado: "operador_asignado_id",
        valor_anterior: null,
        valor_nuevo:
          mixerId != null
            ? `Mixer #${mixerId} -> motorista ${operador.nombre} (#${operadorId})`
            : `Operador ${operador.nombre} (#${operadorId}) sin mixer habitual`,
        motivo: "Asignacion de mixer habitual desde Flota > Operadores",
      },
    });

    revalidatePath("/flota");
    return { ok: true };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error inesperado." };
  }
}

/**
 * Fija QUIÉNES operan una bomba. Son varios a propósito: se relevan por turno dentro del
 * mismo día, y el reparto del trabajo entre ellos sale de la jornada de cada uno en
 * Asistencia — no hay que capturar el turno aparte.
 */
export async function fijarOperadoresBombaAction(
  bombaId: number,
  operadorIds: number[],
): Promise<{ ok: boolean; mensaje?: string }> {
  const g = await exigirGestionFlota();
  if (!g.ok) return g;

  const bomba = await prisma.bombas.findUnique({
    where: { id: bombaId },
    select: { identificador: true, operadores: { select: { operador: { select: { nombre: true } } } } },
  });
  if (!bomba) return { ok: false, mensaje: "Bomba no encontrada." };

  const ids = [...new Set(operadorIds)].filter((x) => Number.isInteger(x) && x > 0);
  const personas = await prisma.operadores.findMany({
    where: { id: { in: ids } },
    select: { id: true, nombre: true, puesto: true },
  });
  if (personas.length !== ids.length) return { ok: false, mensaje: "Alguna persona no existe." };
  // La tabla `operadores` guarda a todo el personal operativo: un dosificador no opera
  // la bomba, y si entrara aquí el Gantt le atribuiría descargas que no son suyas.
  const ajeno = personas.find((p) => !PUESTOS_OPERADOR_BOMBA.includes(p.puesto));
  if (ajeno) {
    return {
      ok: false,
      mensaje: `${ajeno.nombre} no tiene puesto de operador de bomba: no puede quedar asignado a una.`,
    };
  }

  const antes = bomba.operadores.map((o) => o.operador.nombre).join(", ") || "sin operadores";
  await prisma.$transaction([
    prisma.bombas_operadores.deleteMany({ where: { bomba_id: bombaId } }),
    ...(ids.length
      ? [
          prisma.bombas_operadores.createMany({
            data: ids.map((operador_id) => ({ bomba_id: bombaId, operador_id })),
          }),
        ]
      : []),
  ]);

  const despues = personas.map((p) => p.nombre).join(", ") || "sin operadores";
  const sesion = await auth();
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "bombas",
      registro_id: bombaId,
      usuario: sesion?.user?.name ?? sesion?.user?.email ?? "sistema",
      campo_modificado: "operadores",
      valor_anterior: antes,
      valor_nuevo: despues,
      motivo: `Operadores de la bomba ${bomba.identificador}`,
    },
  });

  revalidatePath("/flota");
  revalidatePath("/asistencia");
  return { ok: true };
}
