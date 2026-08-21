"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { volumenDespachadoDe } from "@/lib/calidad/volumen";
import { viajeEsDeSuPlanta } from "@/lib/calidad/planta-lab";
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
  /** De este viaje se tomó muestra en OBRA (lo marca el laboratorista del proyecto). */
  muestraObra = false,
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

  // Solo columnas de OBRA: lo de planta lo escribe `guardarSalidaPlantaAction` y no
  // se deben pisar entre sí (son dos personas distintas capturando el mismo viaje).
  const datos = {
    revenimiento_obra: rev,
    temperatura_concreto: temp,
    muestra_obra: !!muestraObra,
    laboratorista_id: g.userId,
  };
  await prisma.control_calidad_viaje.upsert({
    where: { viaje_id: viajeId },
    update: datos,
    create: { viaje_id: viajeId, ...datos },
  });
  revalidatePath("/calidad");
  return { ok: true };
}

/**
 * ¿Puede capturar la SALIDA DE PLANTA de este viaje? El laboratorista de báscula, si
 * el viaje carga en una de las plantas que tiene asignadas hoy; y siempre el Admin,
 * el Gerente de Control de Calidad y el Jefe de Laboratorio de esa zona.
 */
async function puedeCapturarSalida(
  viajeId: number,
): Promise<{ ok: true; userId: string; quien: string } | { ok: false; mensaje: string }> {
  const alcance = await alcanceActual();
  const sesion = await auth();
  const userId = sesion?.user?.id ?? "";
  const quien = sesion?.user?.name ?? sesion?.user?.email ?? "sistema";
  if (!alcance || !userId) return { ok: false, mensaje: "Sesión no válida." };
  if (alcance.esAdmin || alcance.esGerenteControlCalidad) return { ok: true, userId, quien };

  const viaje = await prisma.viajes.findUnique({
    where: { id: viajeId },
    select: { pedido: { select: { hora_solicitada: true, plantel: { select: { zona: true } } } } },
  });
  if (!viaje) return { ok: false, mensaje: "Viaje no encontrado." };

  if (alcance.esJefeLaboratorio) {
    return viaje.pedido.plantel.zona === alcance.zona
      ? { ok: true, userId, quien }
      : { ok: false, mensaje: "Ese viaje no es de tu zona." };
  }
  if (alcance.esLaboratorista) {
    return (await viajeEsDeSuPlanta(viajeId, userId, viaje.pedido.hora_solicitada))
      ? { ok: true, userId, quien }
      : { ok: false, mensaje: "Ese viaje no carga en la planta que tienes asignada hoy." };
  }
  return { ok: false, mensaje: "Tu rol no permite capturar la salida de planta." };
}

/**
 * Guarda las lecturas a la SALIDA DE PLANTA de un viaje: revenimiento y temperatura
 * medidos en la báscula al terminar la carga, y si de ese camión se tomó muestra en
 * planta. Escribe SOLO esas columnas: las de obra las captura el laboratorista del
 * proyecto y no se pisan.
 */
export async function guardarSalidaPlantaAction(
  viajeId: number,
  revenimiento: number | null,
  temperatura: number | null,
  muestraPlanta = false,
): Promise<{ ok: boolean; mensaje?: string }> {
  const g = await puedeCapturarSalida(viajeId);
  if (!g.ok) return g;

  const rev = numOpc(revenimiento);
  const temp = numOpc(temperatura);
  if (rev === undefined) return { ok: false, mensaje: "Revenimiento inválido." };
  if (temp === undefined) return { ok: false, mensaje: "Temperatura inválida." };

  const datos = {
    revenimiento_planta: rev,
    temperatura_planta: temp,
    muestra_planta: !!muestraPlanta,
  };
  await prisma.control_calidad_viaje.upsert({
    where: { viaje_id: viajeId },
    update: datos,
    create: { viaje_id: viajeId, ...datos, laboratorista_id: g.userId },
  });
  revalidatePath("/calidad");
  revalidatePath("/despacho");
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
 * pedido/cliente/día.
 *
 * Los dos volúmenes se sacan solos y no se teclean a ciegas:
 *  · `m3_programados` = la línea base del PROGRAMA (`volumen_programado`, y si no la
 *    hubiera, el volumen del pedido);
 *  · `m3_colocados` = lo realmente DESPACHADO desde planta (suma del volumen real de
 *    los viajes Completado) cuando el laboratorista no escribe nada; si escribe un
 *    valor, manda el suyo (puede ajustar lo que de verdad se colocó en la obra).
 * Sella el laboratorista que llenó el formulario.
 */
export async function guardarControlGeneralAction(
  pedidoId: number,
  datos: DatosControlGeneral,
): Promise<{ ok: boolean; mensaje?: string }> {
  const g = await puedeCapturarPedido(pedidoId);
  if (!g.ok) return g;

  const pedido = await prisma.pedidos.findUnique({
    where: { id: pedidoId },
    select: {
      volumen_total_m3: true,
      volumen_programado: true,
      viajes: { select: { estado: true, volumen_asignado_m3: true, volumen_real_m3: true } },
    },
  });
  if (!pedido) return { ok: false, mensaje: "Programa no encontrado." };

  const colocadoManual = numOpc(datos.m3_colocados);
  if (colocadoManual === undefined) return { ok: false, mensaje: "m³ colocados inválido." };
  const programados = pedido.volumen_programado ?? pedido.volumen_total_m3;
  const despachado = volumenDespachadoDe(pedido.viajes);
  const colocados = colocadoManual ?? despachado;

  const comun = {
    laboratorista_id: g.userId,
    observaciones: datos.observaciones.trim() || null,
    humedecio_area: !!datos.humedecio_area,
    vibro_concreto: !!datos.vibro_concreto,
    m3_programados: programados,
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
