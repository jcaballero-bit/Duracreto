// Agrupación de los viajes del Modo Manual en BLOQUES por cliente (pedido).
//
// Por qué: la tabla manual mostraba todos los viajes de la planta mezclados en fila
// cronológica, así que el suministro de un cliente quedaba partido por el de otro.
// Ahora se ve como en el modo Automático / Avanzado: un bloque por cliente, en el
// mismo orden de atención (`orden_dia`, la columna "#" de Programación), y adentro
// los viajes en su orden de carga.
//
// Módulo PURO (sin BD ni React) para poder probar la regla de orden.

export interface FilaAgrupable {
  id: number;
  pedidoId: number;
  /** Orden de atención del pedido; solo desempata dos clientes que llegan a la vez. */
  ordenDia: number | null;
  clienteId: number;
  empresa: string;
  proyecto: string;
}

export interface GrupoManual<T> {
  pedidoId: number;
  clienteId: number;
  empresa: string;
  proyecto: string;
  /** Suma del volumen de los viajes del bloque (con lo que el usuario tenga tecleado). */
  totalM3: number;
  filas: T[];
}

/**
 * Agrupa las filas por PEDIDO y ordena los bloques por la **hora de llegada del primer
 * mixer** del cliente (la hora que se le prometió a la obra): así la tabla se lee en el
 * orden en que los clientes reciben concreto. Desempates: `orden_dia` y luego el id del
 * pedido. Dentro del bloque, los viajes van por hora de CARGA (desempate: id), así que
 * editar una hora no reordena a nadie más.
 *
 * Los tiempos y el volumen se reciben como accesores porque en pantalla los valores
 * EFECTIVOS incluyen lo que el usuario acaba de teclear (vista previa optimista).
 */
export function agruparFilasPorPedido<T extends FilaAgrupable>(
  filas: T[],
  cargaMs: (f: T) => number,
  volumen: (f: T) => number,
  llegadaMs: (f: T) => number,
): GrupoManual<T>[] {
  const porPedido = new Map<number, GrupoManual<T>>();
  for (const f of filas) {
    const g = porPedido.get(f.pedidoId) ?? {
      pedidoId: f.pedidoId,
      clienteId: f.clienteId,
      empresa: f.empresa,
      proyecto: f.proyecto,
      totalM3: 0,
      filas: [] as T[],
    };
    g.filas.push(f);
    g.totalM3 += volumen(f);
    porPedido.set(f.pedidoId, g);
  }

  const grupos = [...porPedido.values()];
  for (const g of grupos) {
    g.filas.sort((a, b) => cargaMs(a) - cargaMs(b) || a.id - b.id);
    // Redondeo: sumar 0.5 en coma flotante deja colas tipo 30.000000000000004.
    g.totalM3 = Math.round(g.totalM3 * 100) / 100;
  }

  // Llegada del PRIMER mixer del cliente: la más temprana de sus viajes (no la del
  // primero de la cola, que podría no ser el que llega antes si se editaron horas).
  const primeraLlegada = (g: GrupoManual<T>) =>
    g.filas.length ? Math.min(...g.filas.map(llegadaMs)) : Number.MAX_SAFE_INTEGER;
  const orden = (g: GrupoManual<T>) => g.filas[0]?.ordenDia ?? Number.MAX_SAFE_INTEGER;
  grupos.sort(
    (a, b) =>
      primeraLlegada(a) - primeraLlegada(b) || orden(a) - orden(b) || a.pedidoId - b.pedidoId,
  );
  return grupos;
}
