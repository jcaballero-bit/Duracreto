"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { alcanceActual } from "@/lib/auth/guard";
import {
  ventanaDePedido,
  seTraslapan,
  formatearVentana,
  type ViajeVentana,
} from "@/lib/laboratorio/ventana";

/** Solo Admin o Jefe de Laboratorio gestionan las asignaciones. */
async function autorizar(): Promise<{ ok: true; quien: string } | { ok: false; mensaje: string }> {
  const alcance = await alcanceActual();
  if (!alcance) return { ok: false, mensaje: "Sesión no válida." };
  if (!alcance.esAdmin && !alcance.esJefeLaboratorio) {
    return { ok: false, mensaje: "Solo el Jefe de Laboratorio (o Admin) puede asignar proyectos." };
  }
  const sesion = await auth();
  return { ok: true, quien: sesion?.user?.name ?? sesion?.user?.email ?? "sistema" };
}

// Campos de viaje que necesita el cálculo de ventana.
const SELECT_VIAJE_VENTANA = {
  mixer_id: true,
  hora_llegada_proyecto: true,
  ts_llegada_real: true,
  hora_regreso_planta: true,
  ts_regreso_real: true,
  hora_fin_descarga: true,
  ts_fin_descarga_real: true,
} as const;

/**
 * Asigna (o cambia) el Laboratorista de UN programa (pedido). `laboratoristaId`
 * vacío = "Ninguno" (quita la asignación). Antes de asignar, valida que el horario
 * del programa no se cruce con otro programa YA asignado a ese laboratorista ese
 * día (de un cliente distinto): si se cruza, RECHAZA indicando con cuál y en qué
 * horario.
 */
export async function asignarPedidoAction(
  pedidoId: number,
  laboratoristaId: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const g = await autorizar();
  if (!g.ok) return g;

  // "Ninguno": quitar la asignación de este pedido.
  if (!laboratoristaId) {
    await prisma.asignaciones_laboratorista.deleteMany({ where: { pedido_id: pedidoId } });
    await prisma.bitacora_auditoria.create({
      data: {
        tabla_afectada: "asignaciones_laboratorista",
        registro_id: pedidoId,
        usuario: g.quien,
        campo_modificado: "laboratorista",
        valor_anterior: null,
        valor_nuevo: null,
        motivo: "Programa sin laboratorista (Ninguno)",
      },
    });
    revalidatePath("/laboratorio");
    revalidatePath("/despacho");
    return { ok: true };
  }

  const pedido = await prisma.pedidos.findUnique({
    where: { id: pedidoId },
    select: {
      cliente_id: true,
      hora_solicitada: true,
      viajes: { where: { mixer_id: { not: null } }, select: SELECT_VIAJE_VENTANA },
    },
  });
  if (!pedido) return { ok: false, mensaje: "Programa no encontrado." };

  const ventanaNueva = ventanaDePedido(pedido.viajes as ViajeVentana[], pedido.hora_solicitada);
  if (ventanaNueva) {
    const dia = pedido.hora_solicitada;
    const ini = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate());
    const fin = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() + 1);
    // Otros programas del mismo laboratorista ese día, de cliente DISTINTO (dos
    // programas del mismo proyecto no se cruzan consigo mismos).
    const otros = await prisma.pedidos.findMany({
      where: {
        id: { not: pedidoId },
        cliente_id: { not: pedido.cliente_id },
        hora_solicitada: { gte: ini, lt: fin },
        estado_pedido: "Activo",
        asignacion_lab: { is: { laboratorista_id: laboratoristaId } },
      },
      select: {
        hora_solicitada: true,
        cliente: { select: { empresa: true } },
        viajes: { where: { mixer_id: { not: null } }, select: SELECT_VIAJE_VENTANA },
      },
    });
    for (const o of otros) {
      const vo = ventanaDePedido(o.viajes as ViajeVentana[], o.hora_solicitada);
      if (vo && seTraslapan(ventanaNueva, vo)) {
        return {
          ok: false,
          mensaje:
            `El horario se cruza con "${o.cliente.empresa}" (${formatearVentana(vo)}). ` +
            `Este programa ocupa ${formatearVentana(ventanaNueva)}. ` +
            `Un laboratorista no puede estar en dos proyectos a la vez.`,
        };
      }
    }
  }

  await prisma.asignaciones_laboratorista.upsert({
    where: { pedido_id: pedidoId },
    update: { laboratorista_id: laboratoristaId, creado_por: g.quien },
    create: { pedido_id: pedidoId, laboratorista_id: laboratoristaId, creado_por: g.quien },
  });
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "asignaciones_laboratorista",
      registro_id: pedidoId,
      usuario: g.quien,
      campo_modificado: "laboratorista",
      valor_anterior: null,
      valor_nuevo: `pedido=${pedidoId} laboratorista=${laboratoristaId}`,
      motivo: "Asignación de laboratorista a un programa",
    },
  });

  revalidatePath("/laboratorio");
  revalidatePath("/despacho");
  return { ok: true };
}
