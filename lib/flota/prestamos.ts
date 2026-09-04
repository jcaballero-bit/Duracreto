// PRESTAMO de una unidad a otro plantel, por día.
//
// ── Por qué existe, si ya hay préstamo por hub ──────────────────────────────
// Los planteles sin flota propia (Choloma, Villanueva, La Ceiba, Hazama) ya usan la
// flota de su hub de forma IMPLÍCITA: `candidatosDePlanta` considera candidatos a los
// mixers del plantel Y a los de su hub. Eso es un pool compartido, no un préstamo: la
// unidad sigue "en el aire" y cualquier dependiente de la zona puede tomarla.
//
// El préstamo explícito es más fuerte y resuelve lo que el pool no puede:
//
//  · lo decide una persona para un DÍA concreto y queda registrado (quién, cuándo,
//    por qué), así que sirve para coordinar el traslado físico de la unidad;
//  · FIJA la unidad en el plantel destino: ese día deja de estar disponible en su
//    plantel base y en el resto de la zona, porque físicamente está en otra parte;
//  · funciona entre CUALQUIER par de planteles, no solo hub → dependiente. Puerto
//    Cortés (que tiene flota propia) puede prestarle una unidad a Choloma, algo que
//    el mecanismo de hub no permite expresar.
//
// ── Qué unidades participan en el motor ─────────────────────────────────────
// Mixers y bombas SÍ: prestarlas cambia lo que el motor puede asignar ese día.
// Camiones y pickups NO participan en el motor (los camiones mueven las bombas
// estacionarias y se coordinan a mano; los pickups son de apoyo), así que para ellos
// el préstamo es un registro de coordinación: dice qué unidad va a qué plantel.

/** Tipos de unidad que se pueden prestar. */
export const TIPOS_PRESTABLES = [
  { valor: "Mixer", etiqueta: "Mixer", enElMotor: true },
  { valor: "Bomba", etiqueta: "Bomba", enElMotor: true },
  { valor: "Camion", etiqueta: "Camión", enElMotor: false },
  { valor: "Pickup", etiqueta: "Pickup / vehículo", enElMotor: false },
] as const;

export type TipoUnidadPrestable = (typeof TIPOS_PRESTABLES)[number]["valor"];

export function esTipoPrestable(v: unknown): v is TipoUnidadPrestable {
  return TIPOS_PRESTABLES.some((t) => t.valor === v);
}

export function etiquetaTipo(t: string): string {
  return TIPOS_PRESTABLES.find((x) => x.valor === t)?.etiqueta ?? t;
}

/** ¿Prestar este tipo de unidad cambia lo que el motor puede asignar? */
export function participaEnMotor(t: string): boolean {
  return TIPOS_PRESTABLES.find((x) => x.valor === t)?.enElMotor ?? false;
}

/** Un préstamo, en la forma mínima que necesitan las reglas. */
export interface PrestamoBase {
  unidadTipo: string;
  unidadId: number;
  origenId: number;
  destinoId: number;
}

/**
 * Valida un préstamo antes de guardarlo. Devuelve el motivo del rechazo, o `null` si
 * es válido. Se usa en el servidor: la interfaz no basta.
 */
export function validarPrestamo(p: PrestamoBase): string | null {
  if (!esTipoPrestable(p.unidadTipo)) return "Tipo de unidad no válido.";
  if (!Number.isInteger(p.unidadId) || p.unidadId <= 0) return "Unidad no válida.";
  if (!Number.isInteger(p.destinoId) || p.destinoId <= 0) {
    return "Elige el plantel al que se presta la unidad.";
  }
  if (p.destinoId === p.origenId) {
    return "La unidad ya es de ese plantel: elige otro destino.";
  }
  return null;
}

/**
 * ¿Dónde está EFECTIVAMENTE una unidad ese día? Su plantel base, salvo que esté
 * prestada: entonces, el plantel destino.
 *
 * `prestada` es el préstamo de ESA unidad y ESE día (o `null` si no hay).
 */
export function plantelEfectivo(
  plantelBaseId: number,
  prestada: { destinoId: number } | null,
): number {
  return prestada ? prestada.destinoId : plantelBaseId;
}

/** Índice de los préstamos de un día: "Tipo|id" → destino. */
export type IndicePrestamos = Map<string, number>;

export const clavePrestamo = (unidadTipo: string, unidadId: number) =>
  `${unidadTipo}|${unidadId}`;

export function indexarPrestamos(
  prestamos: { unidadTipo: string; unidadId: number; destinoId: number }[],
): IndicePrestamos {
  return new Map(prestamos.map((p) => [clavePrestamo(p.unidadTipo, p.unidadId), p.destinoId]));
}

/**
 * Filtra las unidades que están EFECTIVAMENTE disponibles en un conjunto de planteles
 * ese día, aplicando los préstamos. Es la pieza que consume el motor.
 *
 *  · una unidad prestada A uno de esos planteles entra, venga de donde venga;
 *  · una unidad prestada FUERA sale, aunque su base esté en la lista (está en otra
 *    parte físicamente);
 *  · las demás se comportan como siempre (su plantel base).
 *
 * `plantelesFuente` es lo que el motor ya consideraba: el plantel y su hub.
 */
export function unidadesDisponiblesEn<T extends { id: number; plantel_base_id: number }>(
  unidades: T[],
  plantelesFuente: number[],
  unidadTipo: string,
  prestamos: IndicePrestamos,
): T[] {
  const fuente = new Set(plantelesFuente);
  return unidades.filter((u) => {
    const destino = prestamos.get(clavePrestamo(unidadTipo, u.id));
    // Prestada: solo cuenta para el plantel al que se presto.
    if (destino != null) return fuente.has(destino);
    return fuente.has(u.plantel_base_id);
  });
}

/**
 * ¿Se puede prestar esta unidad? Reúne los motivos por los que NO conviene, para
 * avisarlos. Ninguno bloquea salvo el mantenimiento: una unidad de baja ese día no
 * puede ir a trabajar a otra planta.
 */
export interface AvisosPrestamo {
  /** Impide guardar (la unidad no está operativa ese día). */
  bloqueante: string | null;
  /** Consecuencias que el usuario debe conocer antes de confirmar. */
  advertencias: string[];
}

export function avisosDePrestamo(o: {
  enMantenimiento: boolean;
  rangoMantenimiento?: string | null;
  estadoUnidad: string;
  /** Viajes que la unidad ya tiene programados ese día en su plantel de origen. */
  viajesComprometidos: number;
  participaEnMotor: boolean;
}): AvisosPrestamo {
  const advertencias: string[] = [];
  if (o.enMantenimiento) {
    return {
      bloqueante: o.rangoMantenimiento
        ? `La unidad tiene mantenimiento programado (${o.rangoMantenimiento}): no puede prestarse ese día.`
        : "La unidad tiene mantenimiento ese día: no puede prestarse.",
      advertencias,
    };
  }
  if (o.estadoUnidad !== "Disponible") {
    return {
      bloqueante: `La unidad está marcada como "${o.estadoUnidad}": ponla Disponible antes de prestarla.`,
      advertencias,
    };
  }
  if (o.viajesComprometidos > 0) {
    advertencias.push(
      `Esta unidad ya tiene ${o.viajesComprometidos} ` +
        `${o.viajesComprometidos === 1 ? "viaje" : "viajes"} programado` +
        `${o.viajesComprometidos === 1 ? "" : "s"} ese día en su plantel. ` +
        "Al prestarla dejará de estar disponible ahí y esos viajes se quedan sin unidad.",
    );
  }
  if (!o.participaEnMotor) {
    advertencias.push(
      "Los camiones y pickups no los asigna el motor de programación: este préstamo queda " +
        "como registro de coordinación (a dónde va la unidad y quién la traslada).",
    );
  }
  return { bloqueante: null, advertencias };
}
