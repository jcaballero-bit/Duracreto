// Orden de las tarjetas de Despacho en vivo dentro de un plantel.
//
// Regla (pedida por el despachador): el orden debe ser EL MISMO del Programa DPCR-08
// —no alfabético— pero sin partir a un cliente. Si Inversiones Fama despacha 5 viajes
// a las 7:00 y Terravista 2 a las 8:00, primero van los 5 de Fama seguidos y después
// los 2 de Terravista; nunca un viaje de otro cliente en medio.
//
// Módulo PURO (sin BD ni React) para poder probarlo: la pantalla solo le pasa los
// viajes ya cargados.

/** Lo mínimo que necesita el ordenador de cada viaje. */
export interface ViajeOrdenable {
  id: number;
  pedidoId: number;
  /** Llegada a obra PROGRAMADA (misma clave con la que el DPCR-08 ordena pedidos). */
  ordenLlegadaMs: number;
  /** Hora PROGRAMADA de carga (no la real: así el orden no salta al despachar). */
  ordenCargaMs: number;
}

/**
 * Ordena los viajes de un plantel: bloques por pedido —el suministro de un cliente va
 * seguido— y los bloques por la llegada del primer viaje de cada pedido, igual que el
 * DPCR-08. Dentro del bloque se conserva la hora programada de carga, así que
 * despachar un viaje NO lo mueve de lugar. Devuelve un arreglo nuevo.
 */
export function ordenarViajesDespacho<T extends ViajeOrdenable>(viajes: T[]): T[] {
  // Cuándo empieza a llegar cada pedido = llegada de su viaje más temprano.
  const inicioDePedido = new Map<number, number>();
  for (const v of viajes) {
    const prev = inicioDePedido.get(v.pedidoId);
    if (prev == null || v.ordenLlegadaMs < prev) inicioDePedido.set(v.pedidoId, v.ordenLlegadaMs);
  }
  const clave = (v: ViajeOrdenable) => inicioDePedido.get(v.pedidoId) ?? Number.MAX_SAFE_INTEGER;

  return [...viajes].sort(
    (a, b) =>
      clave(a) - clave(b) ||
      a.pedidoId - b.pedidoId || // dos pedidos que arrancan a la misma hora
      a.ordenCargaMs - b.ordenCargaMs ||
      a.id - b.id,
  );
}
