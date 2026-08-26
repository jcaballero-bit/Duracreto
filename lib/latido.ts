/**
 * LATIDO de las pantallas en vivo: una firma diminuta que dice si algo cambió.
 *
 * Por qué existe: Despacho, Programación y Confirmaciones se refrescaban cada 10-15 s
 * volviendo a correr TODAS sus consultas (61-78 KB por tick) aunque no hubiera cambiado
 * nada. Medido sobre un día con 41 viajes, eso es ~3.8 GB al mes por cada pestaña de
 * Despacho abierta; con la operación normal (dos despachadores y dos programadores)
 * pasaba de 14 GB, casi el triple del límite del plan gratuito de Neon — que al agotarse
 * SUSPENDE la base hasta el mes siguiente, no la ralentiza.
 *
 * Ahora el navegador pregunta primero por esta firma (~100 bytes) y solo pide el refresco
 * completo cuando cambia. Un tick sin novedades pasa de 61 KB a menos de 200 bytes.
 *
 * Qué mira, y por qué alcanza:
 *  · `viajes` y `pedidos` del rango: conteo + máximo id + máxima `actualizado_en`. El
 *    conteo y el id atrapan altas y bajas; `actualizado_en` (que Prisma mantiene con
 *    @updatedAt) atrapa cualquier edición — estado, volumen, mixer, motorista, horas
 *    reales, confirmación del asesor, cancelación.
 *  · Las tablas satélite que las pantallas muestran (observación del plantel, captura de
 *    calidad del viaje, laboratorista asignado) entran por conteo + máximo id: lo que
 *    importa de ellas es que APAREZCAN, y quien las edita ve su propio cambio al
 *    instante porque su acción ya refresca.
 *
 * Alcance por DÍA, no por zona ni plantel: un cambio en la otra zona provoca un refresco
 * de más (27 KB), y a cambio la firma es una sola consulta para todas las pantallas. Con
 * ~400 cambios reales al día eso sigue siendo dos órdenes de magnitud menos que antes.
 */
import { prisma } from "@/lib/prisma";

export interface RangoLatido {
  /** Inclusive. */
  desde: Date;
  /** Exclusivo. */
  hasta: Date;
}

/** "YYYY-MM-DD" a medianoche local; null si no calza el formato. */
export function diaDesdeISO(texto: string | null | undefined): Date | null {
  const m = (texto ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

const ms = (d: Date | null) => (d ? d.getTime() : 0);

/**
 * Firma del estado del rango. Dos llamadas con la misma firma significan "no hay nada
 * nuevo que mostrar"; cualquier diferencia dispara el refresco de la pantalla.
 */
export async function firmaLatido(rango: RangoLatido): Promise<string> {
  const { desde, hasta } = rango;
  const enRango = { hora_solicitada: { gte: desde, lt: hasta } };

  const [viajes, pedidos, obs, calidad, labs] = await Promise.all([
    prisma.viajes.aggregate({
      where: { pedido: enRango },
      _count: { _all: true },
      _max: { id: true, actualizado_en: true },
    }),
    prisma.pedidos.aggregate({
      where: enRango,
      _count: { _all: true },
      _max: { id: true, actualizado_en: true },
    }),
    prisma.observaciones_plantel.aggregate({
      where: { fecha: { gte: desde, lt: hasta } },
      _count: { _all: true },
      _max: { id: true },
    }),
    prisma.control_calidad_viaje.aggregate({
      where: { viaje: { pedido: enRango } },
      _count: { _all: true },
      _max: { id: true },
    }),
    prisma.asignaciones_laboratorista.aggregate({
      where: { pedido: enRango },
      _count: { _all: true },
      _max: { id: true },
    }),
  ]);

  return [
    viajes._count._all,
    viajes._max.id ?? 0,
    ms(viajes._max.actualizado_en),
    pedidos._count._all,
    pedidos._max.id ?? 0,
    ms(pedidos._max.actualizado_en),
    obs._count._all,
    obs._max.id ?? 0,
    calidad._count._all,
    calidad._max.id ?? 0,
    labs._count._all,
    labs._max.id ?? 0,
  ].join(".");
}
