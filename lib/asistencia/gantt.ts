/**
 * Cruce de la jornada pagada con los viajes realizados: cuánto del tiempo por el que se
 * paga fue trabajo y cuánto quedó sin viaje asignado.
 *
 * Módulo PURO (sin BD). La atribución de "qué viajes son de quién" vive en
 * `gantt-datos.ts`; aquí solo se recortan, fusionan y restan tramos.
 *
 * INVARIANTE que sostiene todo el reporte:
 *   minutos productivos DENTRO de la jornada + minutos sin viaje = duración de la jornada
 * Se cumple por construcción: los tramos se recortan a la ventana de la jornada, se
 * fusionan los solapes (para no contar dos veces un mismo minuto) y el tiempo sin viaje
 * es exactamente lo que queda de la jornada al restarlos.
 *
 * Un tramo que cae FUERA de la jornada no suma como productivo (no se le está pagando
 * dentro de esa ventana): se reporta aparte, porque normalmente significa que la marca
 * del reloj está mal o falta, y eso es justo lo que hay que detectar.
 *
 * NOTA DE LECTURA: un hueco no es culpa de nadie. Puede ser falta de pedidos, la planta
 * ocupada o una espera legítima. Por eso en toda la vista se llama "sin viaje asignado".
 */

export interface Tramo {
  inicioMs: number;
  finMs: number;
}

export interface TramoTrabajo extends Tramo {
  /** Viaje del que sale el tramo. */
  viajeId: number;
  /** Se armó con horas PROGRAMADAS porque faltan las reales. */
  estimado: boolean;
}

export interface Hueco extends Tramo {
  minutos: number;
  /** Se dibuja (superó el umbral del puesto). El total ocioso los incluye todos. */
  marcado: boolean;
  /** Viajes entre los que quedó el hueco (null en los extremos de la jornada). */
  viajeAntes: number | null;
  viajeDespues: number | null;
}

export interface ResumenJornada {
  /** Duración de la jornada pagada, en minutos. */
  minutosJornada: number;
  /** Minutos con viaje DENTRO de la jornada (solapes fusionados). */
  minutosProductivos: number;
  /** Minutos de la jornada sin ningún viaje. */
  minutosSinViaje: number;
  /** Porcentaje de la jornada sin viaje (0 si no hay jornada). */
  pctSinViaje: number;
  /** Tramos productivos ya recortados a la jornada y fusionados. */
  tramos: TramoTrabajo[];
  huecos: Hueco[];
  /** Tramos (o partes) que caen fuera de la jornada registrada. */
  fueraDeJornada: Tramo[];
}

const MIN = 60_000;
const minutos = (ms: number) => Math.round(ms / MIN);

/**
 * Fusiona tramos que se solapan o se tocan, para que un minuto no se cuente dos veces
 * (a un dosificador le pueden coincidir dos cargas, y a un motorista un ciclo con el
 * siguiente si los timestamps se traslapan).
 *
 * Conserva la traza de los viajes fusionados: el primer viaje del grupo manda para el
 * detalle, y el tramo queda marcado como estimado si CUALQUIERA de sus partes lo era.
 */
export function fusionarTramos(tramos: TramoTrabajo[]): TramoTrabajo[] {
  const validos = tramos
    .filter((t) => t.finMs > t.inicioMs)
    .sort((a, b) => a.inicioMs - b.inicioMs || a.finMs - b.finMs);
  const salida: TramoTrabajo[] = [];
  for (const t of validos) {
    const ultimo = salida[salida.length - 1];
    if (ultimo && t.inicioMs <= ultimo.finMs) {
      ultimo.finMs = Math.max(ultimo.finMs, t.finMs);
      ultimo.estimado = ultimo.estimado || t.estimado;
      continue;
    }
    salida.push({ ...t });
  }
  return salida;
}

/** Recorta un tramo a una ventana. Devuelve null si no la toca. */
export function recortar(t: Tramo, desdeMs: number, hastaMs: number): Tramo | null {
  const ini = Math.max(t.inicioMs, desdeMs);
  const fin = Math.min(t.finMs, hastaMs);
  return fin > ini ? { inicioMs: ini, finMs: fin } : null;
}

/** Las partes de un tramo que quedan FUERA de la ventana (antes y/o después). */
function partesFuera(t: Tramo, desdeMs: number, hastaMs: number): Tramo[] {
  const fuera: Tramo[] = [];
  if (t.inicioMs < desdeMs) fuera.push({ inicioMs: t.inicioMs, finMs: Math.min(t.finMs, desdeMs) });
  if (t.finMs > hastaMs) fuera.push({ inicioMs: Math.max(t.inicioMs, hastaMs), finMs: t.finMs });
  return fuera.filter((f) => f.finMs > f.inicioMs);
}

/**
 * Cruza una jornada con los tramos de trabajo de la persona.
 *
 * `umbralHuecoMin` solo decide qué huecos se DIBUJAN; el total ocioso suma todos,
 * también los cortos (una espera de 20 min es normal, pero cuesta igual).
 */
export function cruzarJornada(
  jornada: Tramo | null,
  tramosCrudos: TramoTrabajo[],
  umbralHuecoMin: number,
): ResumenJornada {
  const fusionados = fusionarTramos(tramosCrudos);

  // Sin jornada registrada no hay nada que restar: se devuelven los tramos como están
  // (la vista los dibuja con la advertencia de que falta la jornada).
  if (!jornada || jornada.finMs <= jornada.inicioMs) {
    return {
      minutosJornada: 0,
      minutosProductivos: 0,
      minutosSinViaje: 0,
      pctSinViaje: 0,
      tramos: fusionados,
      huecos: [],
      fueraDeJornada: [],
    };
  }

  const { inicioMs: jIni, finMs: jFin } = jornada;
  const dentro: TramoTrabajo[] = [];
  const fueraDeJornada: Tramo[] = [];

  for (const t of fusionados) {
    const r = recortar(t, jIni, jFin);
    if (r) dentro.push({ ...t, inicioMs: r.inicioMs, finMs: r.finMs });
    fueraDeJornada.push(...partesFuera(t, jIni, jFin));
  }

  // Huecos = la jornada menos los tramos (que ya vienen fusionados y ordenados).
  const huecos: Hueco[] = [];
  let cursor = jIni;
  for (let i = 0; i < dentro.length; i++) {
    const t = dentro[i];
    if (t.inicioMs > cursor) {
      huecos.push(nuevoHueco(cursor, t.inicioMs, umbralHuecoMin, dentro[i - 1]?.viajeId ?? null, t.viajeId));
    }
    cursor = Math.max(cursor, t.finMs);
  }
  if (cursor < jFin) {
    huecos.push(
      nuevoHueco(cursor, jFin, umbralHuecoMin, dentro[dentro.length - 1]?.viajeId ?? null, null),
    );
  }

  const minutosJornada = minutos(jFin - jIni);
  const minutosProductivos = dentro.reduce((s, t) => s + minutos(t.finMs - t.inicioMs), 0);
  // Se deriva por RESTA para que el invariante se cumpla exacto aunque el redondeo al
  // minuto de cada tramo no cuadre por un segundo suelto.
  const minutosSinViaje = Math.max(0, minutosJornada - minutosProductivos);

  return {
    minutosJornada,
    minutosProductivos,
    minutosSinViaje,
    pctSinViaje: minutosJornada > 0 ? Math.round((minutosSinViaje / minutosJornada) * 1000) / 10 : 0,
    tramos: dentro,
    huecos,
    fueraDeJornada,
  };
}

function nuevoHueco(
  inicioMs: number,
  finMs: number,
  umbralMin: number,
  viajeAntes: number | null,
  viajeDespues: number | null,
): Hueco {
  const mins = minutos(finMs - inicioMs);
  return { inicioMs, finMs, minutos: mins, marcado: mins >= umbralMin, viajeAntes, viajeDespues };
}

/** "3h 40m" · "45m" · "—" */
export function textoDuracion(mins: number): string {
  if (mins <= 0) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Semáforo del % sin viaje según los umbrales DEL PUESTO. */
export function tonoOcio(
  pct: number,
  umbrales: { verde_pct: number; amarillo_pct: number },
): "ok" | "warn" | "danger" {
  if (pct < umbrales.verde_pct) return "ok";
  if (pct <= umbrales.amarillo_pct) return "warn";
  return "danger";
}

/**
 * Rango del eje horizontal: del primer inicio al último fin de TODO lo que se dibuja
 * (jornadas y viajes), redondeado a la hora con un margen. No es un eje fijo de 24 h.
 */
export function rangoEje(
  tramos: Tramo[],
  margenMin = 30,
): { desdeMs: number; hastaMs: number } | null {
  const validos = tramos.filter((t) => t.finMs > t.inicioMs);
  if (validos.length === 0) return null;
  const min = Math.min(...validos.map((t) => t.inicioMs)) - margenMin * MIN;
  const max = Math.max(...validos.map((t) => t.finMs)) + margenMin * MIN;
  // Se redondea a la hora en punto para que las líneas del eje caigan en horas exactas.
  const piso = new Date(min);
  piso.setMinutes(0, 0, 0);
  const techo = new Date(max);
  if (techo.getMinutes() > 0 || techo.getSeconds() > 0) {
    techo.setHours(techo.getHours() + 1, 0, 0, 0);
  }
  return { desdeMs: piso.getTime(), hastaMs: techo.getTime() };
}
