"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { alcanceActual } from "@/lib/auth/guard";

/**
 * ¿El usuario puede capturar control de calidad de este pedido? Admin y Gerente de
 * Control de Calidad: cualquiera. JefeLaboratorio: solo los de SU zona. Laboratorista:
 * solo los programas que le fueron ASIGNADOS. Devuelve quién (para laboratorista_id).
 */
async function puedeCapturarPedido(
  pedidoId: number,
): Promise<{ ok: true; userId: string; quien: string } | { ok: false; mensaje: string }> {
  const alcance = await alcanceActual();
  if (!alcance) return { ok: false, mensaje: "Sesión no válida." };
  const sesion = await auth();
  const userId = sesion?.user?.id ?? "";
  const quien = sesion?.user?.name ?? sesion?.user?.email ?? "laboratorista";

  const pedido = await prisma.pedidos.findUnique({
    where: { id: pedidoId },
    select: {
      plantel: { select: { zona: true } },
      asignaciones_lab: { where: { laboratorista_id: userId }, select: { id: true } },
    },
  });
  if (!pedido) return { ok: false, mensaje: "Programa no encontrado." };

  if (alcance.esAdmin || alcance.esGerenteControlCalidad) return { ok: true, userId, quien };
  if (alcance.esJefeLaboratorio) {
    return alcance.zona && pedido.plantel.zona === alcance.zona
      ? { ok: true, userId, quien }
      : { ok: false, mensaje: "Ese programa es de otra zona." };
  }
  if (alcance.esLaboratorista) {
    return pedido.asignaciones_lab.length > 0
      ? { ok: true, userId, quien }
      : { ok: false, mensaje: "Ese programa no está asignado a ti." };
  }
  return { ok: false, mensaje: "Tu rol no permite capturar control de calidad." };
}

/** Número >= 0 o null (cadena vacía → null). Rechaza negativos/no numéricos. */
function numOpc(v: number | null | undefined): number | null | undefined {
  if (v == null) return null;
  if (!Number.isFinite(v) || v < 0) return undefined; // undefined = inválido
  return v;
}

/**
 * Guarda (upsert) el control de calidad POR VIAJE: revenimiento en obra (pulgadas) y
 * temperatura del concreto. Una fila por viaje. Sella el laboratorista que lo capturó.
 */
export async function guardarControlViajeAction(
  viajeId: number,
  revenimiento: number | null,
  temperatura: number | null,
): Promise<{ ok: boolean; mensaje?: string }> {
  const viaje = await prisma.viajes.findUnique({
    where: { id: viajeId },
    select: { pedido_id: true },
  });
  if (!viaje) return { ok: false, mensaje: "Viaje no encontrado." };
  const g = await puedeCapturarPedido(viaje.pedido_id);
  if (!g.ok) return g;

  const rev = numOpc(revenimiento);
  const temp = numOpc(temperatura);
  if (rev === undefined) return { ok: false, mensaje: "Revenimiento inválido." };
  if (temp === undefined) return { ok: false, mensaje: "Temperatura inválida." };

  await prisma.control_calidad_viaje.upsert({
    where: { viaje_id: viajeId },
    update: { revenimiento_obra: rev, temperatura_concreto: temp, laboratorista_id: g.userId },
    create: {
      viaje_id: viajeId,
      revenimiento_obra: rev,
      temperatura_concreto: temp,
      laboratorista_id: g.userId,
    },
  });
  revalidatePath("/calidad");
  return { ok: true };
}

export interface DatosControlGeneral {
  observaciones: string;
  humedecio_area: boolean;
  vibro_concreto: boolean;
  m3_colocados: number | null;
  aplico_aditivo: boolean;
  aditivo_unidades: string;
  uso_curador: boolean;
  existe_reclamo: boolean;
  detalle_reclamo: string;
}

/**
 * Guarda (upsert) las preguntas GENERALES del control de calidad: una vez por
 * pedido/cliente/día. `m3_programados` se toma automático de pedidos.volumen_total_m3
 * (no se recaptura). Sella el laboratorista que llenó el formulario.
 */
export async function guardarControlGeneralAction(
  pedidoId: number,
  datos: DatosControlGeneral,
): Promise<{ ok: boolean; mensaje?: string }> {
  const g = await puedeCapturarPedido(pedidoId);
  if (!g.ok) return g;

  const pedido = await prisma.pedidos.findUnique({
    where: { id: pedidoId },
    select: { volumen_total_m3: true },
  });
  if (!pedido) return { ok: false, mensaje: "Programa no encontrado." };

  const colocados = numOpc(datos.m3_colocados);
  if (colocados === undefined) return { ok: false, mensaje: "m³ colocados inválido." };

  const comun = {
    laboratorista_id: g.userId,
    observaciones: datos.observaciones.trim() || null,
    humedecio_area: !!datos.humedecio_area,
    vibro_concreto: !!datos.vibro_concreto,
    m3_programados: pedido.volumen_total_m3,
    m3_colocados: colocados,
    aplico_aditivo: !!datos.aplico_aditivo,
    aditivo_unidades: datos.aplico_aditivo ? datos.aditivo_unidades.trim() || null : null,
    uso_curador: !!datos.uso_curador,
    existe_reclamo: !!datos.existe_reclamo,
    detalle_reclamo: datos.existe_reclamo ? datos.detalle_reclamo.trim() || null : null,
  };

  await prisma.control_calidad_general.upsert({
    where: { pedido_id: pedidoId },
    update: comun,
    create: { pedido_id: pedidoId, ...comun },
  });
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "control_calidad_general",
      registro_id: pedidoId,
      usuario: g.quien,
      campo_modificado: "control_calidad",
      valor_anterior: null,
      valor_nuevo: `m3 colocados=${colocados ?? "-"}`,
      motivo: "Control de calidad general (preguntas al finalizar)",
    },
  });
  revalidatePath("/calidad");
  return { ok: true };
}
