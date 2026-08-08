// Motor de 2 PASADAS (puro, sin BD): decide el `orden_dia` de los pedidos de un día
// para un plantel. NO calcula los horarios finales (de eso se encarga la cascada de
// `asignacion.ts`, que consume `orden_dia`); aquí solo se decide el ORDEN óptimo:
//
//   Pasada 1 — ANCLAS: pedidos de más de 1 viaje o con hora fija. Definen el
//     esqueleto del día. Las de hora fija ocupan su ventana exacta; las multi-viaje
//     se empacan secuencialmente evitando las fijas.
//   Pasada 2 — RELLENO: pedidos de 1 viaje. Cada uno se coloca en el hueco entre
//     anclas más AJUSTADO que le entra (best-fit), no en el más grande, para no
//     desperdiciar espacio. Un hueco menor a `margenMin` no se ofrece.
//
// El resultado es un `orden_dia` que, al correr la cascada secuencial, aproxima el
// relleno de huecos (un corto con `orden_dia` menor que el ancla que lo sigue cae
// antes que ella). La cascada real ajusta los tiempos exactos respetando flota.

export interface Intervalo {
  inicioMs: number;
  finMs: number;
}
export interface Hueco {
  inicioMs: number;
  finMs: number;
  durMin: number;
}

const MIN = 60_000;

/**
 * Huecos libres (>= `margenMin`) dentro de [apertura, cierre] dado un conjunto de
 * intervalos ocupados (en cualquier orden). Fusiona solapados. Incluye el hueco de
 * cola hasta el cierre.
 */
export function calcularHuecos(
  ocupados: Intervalo[],
  aperturaMs: number,
  cierreMs: number,
  margenMin: number,
): Hueco[] {
  const ord = [...ocupados]
    .filter((o) => o.finMs > o.inicioMs)
    .sort((a, b) => a.inicioMs - b.inicioMs);
  const fusion: Intervalo[] = [];
  for (const o of ord) {
    const ult = fusion[fusion.length - 1];
    if (ult && o.inicioMs <= ult.finMs) ult.finMs = Math.max(ult.finMs, o.finMs);
    else fusion.push({ ...o });
  }
  const huecos: Hueco[] = [];
  let cursor = aperturaMs;
  const push = (ini: number, fin: number) => {
    const dur = (fin - ini) / MIN;
    if (dur >= margenMin) huecos.push({ inicioMs: ini, finMs: fin, durMin: Math.round(dur) });
  };
  for (const m of fusion) {
    if (m.inicioMs > cursor) push(cursor, m.inicioMs);
    cursor = Math.max(cursor, m.finMs);
  }
  if (cierreMs > cursor) push(cursor, cierreMs);
  return huecos;
}

/** Primer instante >= apertura donde cabe `durMin` sin solapar los ocupados. */
function primerHuecoDisponible(
  ocupados: Intervalo[],
  aperturaMs: number,
  durMin: number,
): number {
  const durMs = durMin * MIN;
  const ord = [...ocupados].sort((a, b) => a.inicioMs - b.inicioMs);
  let cursor = aperturaMs;
  for (const m of ord) {
    if (m.finMs <= cursor) continue;
    if (m.inicioMs - cursor >= durMs) return cursor; // cabe antes de este ocupado
    cursor = Math.max(cursor, m.finMs);
  }
  return cursor; // al final de todo
}

/**
 * Best-fit: coloca `durMin` en el hueco ACOTADO (entre dos ocupados) más ajustado que
 * lo contenga con `margenMin` de respiro. Si ninguno acotado sirve, va al final (cola).
 */
function mejorHueco(
  ocupados: Intervalo[],
  aperturaMs: number,
  cierreMs: number,
  durMin: number,
  margenMin: number,
): number {
  const necesitaMs = (durMin + margenMin) * MIN;
  const huecos = calcularHuecos(ocupados, aperturaMs, cierreMs, 0);
  let mejor: Hueco | null = null;
  for (const h of huecos) {
    if (h.finMs >= cierreMs) continue; // la cola se maneja aparte (no es "hueco entre anclas")
    const libre = h.finMs - h.inicioMs;
    if (libre >= necesitaMs) {
      if (!mejor || h.finMs - h.inicioMs < mejor.finMs - mejor.inicioMs) mejor = h;
    }
  }
  if (mejor) return mejor.inicioMs;
  return primerHuecoDisponible(ocupados, aperturaMs, durMin); // a la cola
}

export interface PedidoOrg {
  id: number;
  plantaId: number; // planta primaria (para agrupar la línea de tiempo del día)
  esAncla: boolean; // multi-viaje o hora fija
  horaFija: boolean; // hora_bloqueada
  llegadaMs: number; // hora_solicitada
  inicioFijoMs: number | null; // si hora fija: inicio de carga fijo (llegada - transporte - carga)
  duracionMin: number; // minutos de carga a reservar
}
export interface OpcionesOrg {
  aperturaMs: number;
  cierreMs: number;
  margenMin: number;
}

/**
 * Devuelve la asignación de `orden_dia` (1..N) para los pedidos del plantel según las
 * 2 pasadas. Es puro y determinista.
 */
export function planificarDosPasadas(
  pedidos: PedidoOrg[],
  o: OpcionesOrg,
): { id: number; orden: number }[] {
  const porPlanta = new Map<number, PedidoOrg[]>();
  for (const p of pedidos) {
    const arr = porPlanta.get(p.plantaId);
    if (arr) arr.push(p);
    else porPlanta.set(p.plantaId, [p]);
  }

  const inicioDe = new Map<number, number>(); // pedidoId → inicio intencionado (ms)

  for (const lista of porPlanta.values()) {
    const ocupados: Intervalo[] = [];

    // Pasada 1a — anclas de HORA FIJA en su ventana exacta.
    const fijas = lista
      .filter((p) => p.esAncla && p.horaFija && p.inicioFijoMs != null)
      .sort((a, b) => a.inicioFijoMs! - b.inicioFijoMs!);
    for (const a of fijas) {
      const ini = a.inicioFijoMs!;
      ocupados.push({ inicioMs: ini, finMs: ini + a.duracionMin * MIN });
      inicioDe.set(a.id, ini);
    }
    // Pasada 1b — anclas multi-viaje (no fijas), empacadas por llegada evitando fijas.
    const anclasMoviles = lista
      .filter((p) => p.esAncla && !(p.horaFija && p.inicioFijoMs != null))
      .sort((a, b) => a.llegadaMs - b.llegadaMs);
    for (const a of anclasMoviles) {
      const ini = primerHuecoDisponible(ocupados, o.aperturaMs, a.duracionMin);
      ocupados.push({ inicioMs: ini, finMs: ini + a.duracionMin * MIN });
      inicioDe.set(a.id, ini);
    }
    // Pasada 2 — cortos (1 viaje) por best-fit decreciente (los más largos primero).
    const cortos = lista
      .filter((p) => !p.esAncla)
      .sort((a, b) => b.duracionMin - a.duracionMin || a.llegadaMs - b.llegadaMs);
    for (const c of cortos) {
      const ini = mejorHueco(ocupados, o.aperturaMs, o.cierreMs, c.duracionMin, o.margenMin);
      ocupados.push({ inicioMs: ini, finMs: ini + c.duracionMin * MIN });
      inicioDe.set(c.id, ini);
    }
  }

  // Orden global por inicio intencionado (desempate: hora fija primero, luego llegada, id).
  const conInicio = pedidos.map((p) => ({ p, ini: inicioDe.get(p.id) ?? p.llegadaMs }));
  conInicio.sort(
    (x, y) =>
      x.ini - y.ini ||
      Number(y.p.horaFija) - Number(x.p.horaFija) ||
      x.p.llegadaMs - y.p.llegadaMs ||
      x.p.id - y.p.id,
  );
  return conInicio.map((x, i) => ({ id: x.p.id, orden: i + 1 }));
}
