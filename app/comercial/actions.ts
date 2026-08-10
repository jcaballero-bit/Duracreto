"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";

type Res = { ok: boolean; mensaje?: string };

/** Solo Gerente Comercial o Administrador gestionan metas. */
async function exigirComercial(): Promise<
  { ok: true; quien: string } | { ok: false; mensaje: string }
> {
  const sesion = await auth();
  if (!sesion?.user) return { ok: false, mensaje: "Sesión no válida." };
  const alcance = calcularAlcance(sesion.user.roles ?? [], sesion.user.zona ?? null);
  if (!alcance.esAdmin && !alcance.esGerenteComercial) {
    return { ok: false, mensaje: "Solo el Gerente Comercial o el Administrador pueden hacer esto." };
  }
  return { ok: true, quien: sesion.user.name ?? sesion.user.email ?? "gerente" };
}

/**
 * Crea o actualiza la meta de m³ de un asesor para un mes. Si el valor es 0 o
 * vacío, borra la meta (queda "sin meta"). Registra en bitácora.
 */
export async function guardarMetaAction(
  asesorId: number,
  anio: number,
  mes: number,
  metaM3: number | null,
): Promise<Res> {
  const ctx = await exigirComercial();
  if (!ctx.ok) return ctx;
  if (!asesorId || !anio || mes < 1 || mes > 12) {
    return { ok: false, mensaje: "Datos inválidos." };
  }

  try {
    const existente = await prisma.metas_asesor.findUnique({
      where: { asesor_id_anio_mes: { asesor_id: asesorId, anio, mes } },
    });

    if (metaM3 == null || !(metaM3 > 0)) {
      // Borrar la meta (vuelve a "sin meta definida").
      if (existente) {
        await prisma.metas_asesor.delete({ where: { id: existente.id } });
        await auditar(existente.id, ctx.quien, String(existente.meta_m3), null, asesorId, anio, mes);
      }
      revalidatePath("/comercial");
      return { ok: true };
    }

    if (existente) {
      await prisma.metas_asesor.update({
        where: { id: existente.id },
        data: { meta_m3: metaM3, creado_por: ctx.quien },
      });
      await auditar(existente.id, ctx.quien, String(existente.meta_m3), String(metaM3), asesorId, anio, mes);
    } else {
      const creada = await prisma.metas_asesor.create({
        data: { asesor_id: asesorId, anio, mes, meta_m3: metaM3, creado_por: ctx.quien },
      });
      await auditar(creada.id, ctx.quien, null, String(metaM3), asesorId, anio, mes);
    }
    revalidatePath("/comercial");
    return { ok: true };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error inesperado." };
  }
}

/**
 * SOLO ADMINISTRADOR: elimina una cancelación hecha por error para que NO afecte el
 * desempeño del asesor. Borra el pedido cancelado (y en cascada sus viajes); si venía
 * de una proyección del Programa Semana, la devuelve a "Pendiente" para poder
 * reprogramarla. Deja rastro en la bitácora. Solo aplica a pedidos ya CANCELADOS.
 */
export async function eliminarCancelacionAction(pedidoId: number): Promise<Res> {
  const sesion = await auth();
  if (!sesion?.user) return { ok: false, mensaje: "Sesión no válida." };
  const alcance = calcularAlcance(sesion.user.roles ?? [], sesion.user.zona ?? null);
  if (!alcance.esAdmin) {
    return { ok: false, mensaje: "Solo el Administrador puede eliminar cancelaciones." };
  }
  const quien = sesion.user.name ?? sesion.user.email ?? "admin";

  const pedido = await prisma.pedidos.findUnique({
    where: { id: pedidoId },
    select: {
      estado_pedido: true,
      volumen_programado: true,
      volumen_total_m3: true,
      motivo_cancelacion: true,
      cliente: { select: { empresa: true } },
    },
  });
  if (!pedido) return { ok: false, mensaje: "Pedido no encontrado." };
  if (pedido.estado_pedido !== "Cancelado") {
    return { ok: false, mensaje: "Solo se pueden eliminar cancelaciones (pedidos cancelados)." };
  }

  try {
    const m3 = pedido.volumen_programado ?? pedido.volumen_total_m3;
    // Bitácora ANTES de borrar (el pedido desaparece; registro_id no es FK).
    await prisma.bitacora_auditoria.create({
      data: {
        tabla_afectada: "pedidos",
        registro_id: pedidoId,
        usuario: quien,
        campo_modificado: "estado_pedido",
        valor_anterior: "Cancelado",
        valor_nuevo: "(eliminado)",
        motivo: `Cancelacion eliminada por error: ${pedido.cliente.empresa}, ${m3} m3 (motivo original: ${pedido.motivo_cancelacion ?? "-"})`,
      },
    });
    // Si venía de una proyección semanal, devolverla a Pendiente (y soltar el vínculo).
    await prisma.solicitudes_anticipadas.updateMany({
      where: { pedido_id: pedidoId },
      data: { estado: "Pendiente", pedido_id: null },
    });
    // Borrar el pedido; viajes y asignación de laboratorista caen en cascada.
    await prisma.pedidos.delete({ where: { id: pedidoId } });

    revalidatePath("/comercial");
    return { ok: true };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "No se pudo eliminar la cancelación." };
  }
}

/**
 * SOLO ADMINISTRADOR: edita la FECHA y el VOLUMEN de una adición o cancelación del
 * registro comercial (`/comercial/asesor/[id]`). Ambos valores son DERIVADOS del
 * pedido, así que se ajustan las columnas que los producen — sin tocar los viajes
 * (la ejecución real queda intacta):
 *  - Volumen de una CANCELACIÓN = programado − suministrado ⇒ se fija
 *    `volumen_programado = suministrado + volumen`.
 *  - Volumen de una ADICIÓN = suministrado − programado ⇒ se fija
 *    `volumen_programado = max(0, suministrado − volumen)` (no puede adicionarse más de
 *    lo suministrado; si se pide más, se topa a lo suministrado).
 *  - Fecha: una CANCELACIÓN de un pedido ya cancelado mueve `fecha_cancelacion`; en
 *    cualquier otro caso (adición, o cancelación por "suministró menos") mueve el día
 *    de `hora_solicitada`. Se conserva la hora del día original.
 * Deja rastro en la bitácora.
 */
export async function editarEventoComercialAction(
  pedidoId: number,
  tipo: "adicion" | "cancelacion",
  nuevaFechaISO: string, // "YYYY-MM-DD"
  nuevoVolumen: number,
): Promise<Res> {
  const sesion = await auth();
  if (!sesion?.user) return { ok: false, mensaje: "Sesión no válida." };
  const alcance = calcularAlcance(sesion.user.roles ?? [], sesion.user.zona ?? null);
  if (!alcance.esAdmin) {
    return { ok: false, mensaje: "Solo el Administrador puede editar adiciones o cancelaciones." };
  }
  const quien = sesion.user.name ?? sesion.user.email ?? "admin";

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nuevaFechaISO);
  if (!m) return { ok: false, mensaje: "Fecha inválida." };
  if (!(nuevoVolumen > 0)) return { ok: false, mensaje: "El volumen debe ser mayor que 0." };

  const pedido = await prisma.pedidos.findUnique({
    where: { id: pedidoId },
    select: {
      estado_pedido: true,
      volumen_programado: true,
      volumen_total_m3: true,
      hora_solicitada: true,
      fecha_cancelacion: true,
      cliente: { select: { empresa: true } },
      viajes: { select: { estado: true, volumen_asignado_m3: true } },
    },
  });
  if (!pedido) return { ok: false, mensaje: "Pedido no encontrado." };

  const suministrado = pedido.viajes
    .filter((v) => v.estado === "Completado")
    .reduce((s, v) => s + v.volumen_asignado_m3, 0);
  const redondear = (n: number) => Math.round(n * 100) / 100;

  // Nuevo día conservando la hora del instante original de referencia.
  const refFecha =
    tipo === "cancelacion" && pedido.estado_pedido === "Cancelado"
      ? pedido.fecha_cancelacion ?? pedido.hora_solicitada
      : pedido.hora_solicitada;
  const nuevaFecha = new Date(refFecha);
  nuevaFecha.setFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  let nuevoProgramado: number;
  let toppedAviso: string | undefined;
  if (tipo === "cancelacion") {
    nuevoProgramado = redondear(suministrado + nuevoVolumen);
  } else {
    const pedidoV = redondear(suministrado - nuevoVolumen);
    nuevoProgramado = Math.max(0, pedidoV);
    if (pedidoV < 0) {
      toppedAviso = `No se puede adicionar más de lo suministrado (${redondear(suministrado)} m³); se registró esa cantidad.`;
    }
  }

  const data: {
    volumen_programado: number;
    volumen_total_m3?: number;
    fecha_cancelacion?: Date;
    hora_solicitada?: Date;
  } = { volumen_programado: nuevoProgramado };
  // El total del pedido nunca debe quedar por debajo de la base ni de lo suministrado.
  data.volumen_total_m3 = Math.max(pedido.volumen_total_m3, nuevoProgramado, redondear(suministrado));
  if (tipo === "cancelacion" && pedido.estado_pedido === "Cancelado") {
    data.fecha_cancelacion = nuevaFecha;
  } else {
    data.hora_solicitada = nuevaFecha;
  }

  try {
    await prisma.pedidos.update({ where: { id: pedidoId }, data });
    await prisma.bitacora_auditoria.create({
      data: {
        tabla_afectada: "pedidos",
        registro_id: pedidoId,
        usuario: quien,
        campo_modificado: tipo === "adicion" ? "adicion" : "cancelacion",
        valor_anterior: `programado ${pedido.volumen_programado ?? pedido.volumen_total_m3} m3`,
        valor_nuevo: `${tipo} ${nuevoVolumen} m3 @ ${nuevaFechaISO}`,
        motivo: `Admin edito ${tipo} de ${pedido.cliente.empresa} (fecha/volumen)`,
      },
    });
    revalidatePath("/comercial");
    return { ok: true, mensaje: toppedAviso };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "No se pudo editar." };
  }
}

async function auditar(
  registroId: number,
  quien: string,
  anterior: string | null,
  nuevo: string | null,
  asesorId: number,
  anio: number,
  mes: number,
) {
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "metas_asesor",
      registro_id: registroId,
      usuario: quien,
      campo_modificado: "meta_m3",
      valor_anterior: anterior,
      valor_nuevo: nuevo,
      motivo: `Meta asesor #${asesorId} ${mes}/${anio}`,
    },
  });
}
