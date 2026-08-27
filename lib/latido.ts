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
  /**
   * Planteles que la pantalla muestra (alcance del rol + filtro de la pantalla).
   * `null` o vacío = todos. Sin esto, a un Despachador del Norte le refrescaba la
   * pantalla cada cambio de la otra zona: un recargo de la pantalla completa por algo
   * que ni siquiera ve.
   */
  plantelIds?: number[] | null;
}

/** "YYYY-MM-DD" a medianoche local; null si no calza el formato. */
export function diaDesdeISO(texto: string | null | undefined): Date | null {
  const m = (texto ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

/**
 * Firma del estado del rango. Dos llamadas con la misma firma significan "no hay nada
 * nuevo que mostrar"; cualquier diferencia dispara el refresco de la pantalla.
 */
export async function firmaLatido(rango: RangoLatido): Promise<string> {
  const { desde, hasta } = rango;
  // `null` = sin límite. Se pasa como arreglo para que el predicado sea uno solo:
  // `(:ids IS NULL OR plantel_id = ANY(:ids))`.
  const ids = rango.plantelIds && rango.plantelIds.length > 0 ? rango.plantelIds : null;

  // UNA sola consulta, no cinco.
  //
  // Esto se corre cada 30-60 s por pestaña abierta: es la operación más frecuente del
  // sistema. Cinco `aggregate` de Prisma son cinco viajes de ida y vuelta a la base, y
  // el costo de un latido no está en los bytes del resultado (son ~100) sino en el
  // número de consultas. Con subconsultas escalares es una sola fila y un solo viaje.
  //
  // `to_char(...,'US')` en vez de un timestamp: la firma solo se compara consigo misma,
  // así que basta con que cambie cuando cambia el dato. Los NULL caen a 0 con COALESCE
  // para que la firma nunca sea NULL (un rango sin datos también tiene firma válida).
  const filas = await prisma.$queryRaw<{ firma: string }[]>`
    SELECT concat_ws('.',
      (SELECT count(*) FROM viajes v JOIN pedidos p ON p.id = v.pedido_id
        WHERE p.hora_solicitada >= ${desde} AND p.hora_solicitada < ${hasta}
          AND (${ids}::int[] IS NULL OR p.plantel_id = ANY(${ids}::int[]))),
      (SELECT coalesce(max(v.id), 0) FROM viajes v JOIN pedidos p ON p.id = v.pedido_id
        WHERE p.hora_solicitada >= ${desde} AND p.hora_solicitada < ${hasta}
          AND (${ids}::int[] IS NULL OR p.plantel_id = ANY(${ids}::int[]))),
      (SELECT coalesce(max(to_char(v.actualizado_en, 'YYYYMMDDHH24MISSUS')), '0')
        FROM viajes v JOIN pedidos p ON p.id = v.pedido_id
        WHERE p.hora_solicitada >= ${desde} AND p.hora_solicitada < ${hasta}
          AND (${ids}::int[] IS NULL OR p.plantel_id = ANY(${ids}::int[]))),
      (SELECT count(*) FROM pedidos p
        WHERE p.hora_solicitada >= ${desde} AND p.hora_solicitada < ${hasta}
          AND (${ids}::int[] IS NULL OR p.plantel_id = ANY(${ids}::int[]))),
      (SELECT coalesce(max(p.id), 0) FROM pedidos p
        WHERE p.hora_solicitada >= ${desde} AND p.hora_solicitada < ${hasta}
          AND (${ids}::int[] IS NULL OR p.plantel_id = ANY(${ids}::int[]))),
      (SELECT coalesce(max(to_char(p.actualizado_en, 'YYYYMMDDHH24MISSUS')), '0') FROM pedidos p
        WHERE p.hora_solicitada >= ${desde} AND p.hora_solicitada < ${hasta}
          AND (${ids}::int[] IS NULL OR p.plantel_id = ANY(${ids}::int[]))),
      (SELECT count(*) FROM observaciones_plantel o
        WHERE o.fecha >= ${desde} AND o.fecha < ${hasta}
          AND (${ids}::int[] IS NULL OR o.plantel_id = ANY(${ids}::int[]))),
      (SELECT coalesce(max(o.id), 0) FROM observaciones_plantel o
        WHERE o.fecha >= ${desde} AND o.fecha < ${hasta}
          AND (${ids}::int[] IS NULL OR o.plantel_id = ANY(${ids}::int[]))),
      (SELECT count(*) FROM control_calidad_viaje c
        JOIN viajes v ON v.id = c.viaje_id JOIN pedidos p ON p.id = v.pedido_id
        WHERE p.hora_solicitada >= ${desde} AND p.hora_solicitada < ${hasta}
          AND (${ids}::int[] IS NULL OR p.plantel_id = ANY(${ids}::int[]))),
      (SELECT coalesce(max(c.id), 0) FROM control_calidad_viaje c
        JOIN viajes v ON v.id = c.viaje_id JOIN pedidos p ON p.id = v.pedido_id
        WHERE p.hora_solicitada >= ${desde} AND p.hora_solicitada < ${hasta}
          AND (${ids}::int[] IS NULL OR p.plantel_id = ANY(${ids}::int[]))),
      (SELECT count(*) FROM asignaciones_laboratorista a
        JOIN pedidos p ON p.id = a.pedido_id
        WHERE p.hora_solicitada >= ${desde} AND p.hora_solicitada < ${hasta}
          AND (${ids}::int[] IS NULL OR p.plantel_id = ANY(${ids}::int[]))),
      (SELECT coalesce(max(a.id), 0) FROM asignaciones_laboratorista a
        JOIN pedidos p ON p.id = a.pedido_id
        WHERE p.hora_solicitada >= ${desde} AND p.hora_solicitada < ${hasta}
          AND (${ids}::int[] IS NULL OR p.plantel_id = ANY(${ids}::int[])))
    ) AS firma`;

  return filas[0]?.firma ?? "0";
}
