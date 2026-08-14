// ─────────────────────────────────────────────────────────────────────────────
// Helpers puros de tiempo y duración. Sin acceso a BD: fáciles de probar.
// ─────────────────────────────────────────────────────────────────────────────
import {
  MIN_DESCARGA_POR_M3,
  MIN_DESCARGA_POR_M3_DEFAULT,
  MIN_SALIDA_TRAS_CARGA,
} from "./config";

/** Suma `minutos` a una fecha y devuelve una nueva fecha. */
export function sumarMinutos(fecha: Date, minutos: number): Date {
  return new Date(fecha.getTime() + minutos * 60_000);
}

/** Diferencia en minutos entre dos fechas (b - a). */
export function diferenciaMinutos(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60_000;
}

/**
 * Duración de carga (minutos) de un volumen dado a la capacidad de dosificación
 * de la planta. Cargar V m³ a R m³/h toma V/R horas = V*60/R minutos. Como la
 * carga es serial por planta, esto respeta automáticamente el límite de m³/h en
 * cualquier ventana de 60 minutos.
 */
export function minutosDeCarga(volumen: number, capacidadPlantaM3h: number): number {
  if (capacidadPlantaM3h <= 0) return 0;
  return (volumen * 60) / capacidadPlantaM3h;
}

/** Duración de descarga (minutos) según volumen y tipo de descarga. */
export function minutosDeDescarga(volumen: number, tipoDescarga: string): number {
  const ritmo = MIN_DESCARGA_POR_M3[tipoDescarga] ?? MIN_DESCARGA_POR_M3_DEFAULT;
  return volumen * ritmo;
}

/** Parámetros para derivar los tiempos de un viaje a partir del inicio de carga. */
export interface ParamsTiempoViaje {
  alistamientoMin: number; // plantas.tiempo_alistamiento_min
  capacidadPlantaM3h: number; // plantas.capacidad_m3h (ritmo de dosificación)
  volumen: number; // m³ del viaje
  tViajeMin: number; // transporte ida (planta → obra)
  tRegresoMin: number; // transporte regreso (obra → planta)
  tipoDescarga: string; // define el ritmo de descarga
}

/** Todos los hitos de un viaje, en ms epoch, derivados del inicio de carga. */
export interface TiemposViaje {
  inicioCargaMs: number;
  finCargaMs: number;
  salidaMs: number;
  llegadaMs: number;
  inicioDescargaMs: number;
  finDescargaMs: number;
  regresoMs: number;
}

/**
 * Deriva TODOS los hitos de un viaje a partir de su inicio de carga (PURO, sin BD).
 * Es exactamente la misma matemática que usa la cascada del motor, extraída para que
 * el modo MANUAL la reutilice — el usuario teclea el inicio de carga y las columnas
 * calculadas (salida/llegada/descarga/regreso) se actualizan al instante, idénticas a
 * lo que persiste el servidor. NO reprograma nada: solo calcula un viaje aislado.
 */
export function tiemposDeViaje(inicioCargaMs: number, p: ParamsTiempoViaje): TiemposViaje {
  const finCargaMs = inicioCargaMs + (p.alistamientoMin + minutosDeCarga(p.volumen, p.capacidadPlantaM3h)) * 60_000;
  const salidaMs = finCargaMs + MIN_SALIDA_TRAS_CARGA * 60_000;
  const llegadaMs = salidaMs + p.tViajeMin * 60_000;
  const inicioDescargaMs = llegadaMs;
  const finDescargaMs = inicioDescargaMs + minutosDeDescarga(p.volumen, p.tipoDescarga) * 60_000;
  const regresoMs = finDescargaMs + p.tRegresoMin * 60_000;
  return { inicioCargaMs, finCargaMs, salidaMs, llegadaMs, inicioDescargaMs, finDescargaMs, regresoMs };
}

/**
 * Minutos entre el INICIO DE CARGA y la LLEGADA a obra: alistamiento + dosificación
 * + preparación de salida + transporte. Es el tramo que hay que "descontar" cuando se
 * programa desde la hora comprometida con el cliente.
 */
export function minutosCargaALlegada(p: ParamsTiempoViaje): number {
  return (
    p.alistamientoMin +
    minutosDeCarga(p.volumen, p.capacidadPlantaM3h) +
    MIN_SALIDA_TRAS_CARGA +
    p.tViajeMin
  );
}

/**
 * A qué hora hay que EMPEZAR A CARGAR para llegar a obra a `llegadaMs`. Es el inverso
 * exacto de `tiemposDeViaje`: se define restando el mismo tramo que aquella suma, así
 * que ida y vuelta no se pueden desalinear.
 */
export function inicioCargaDesdeLlegada(llegadaMs: number, p: ParamsTiempoViaje): number {
  return llegadaMs - minutosCargaALlegada(p) * 60_000;
}

/**
 * Todos los hitos del viaje partiendo de la hora de LLEGADA comprometida con el
 * cliente ("el concreto tiene que estar en obra a las 8:00"): calcula hacia ATRÁS la
 * carga y hacia ADELANTE la descarga y el regreso. PURO, sin BD.
 */
export function tiemposDesdeLlegada(llegadaMs: number, p: ParamsTiempoViaje): TiemposViaje {
  return tiemposDeViaje(inicioCargaDesdeLlegada(llegadaMs, p), p);
}

/** ¿Dos rangos de tiempo [aIni,aFin) y [bIni,bFin) se traslapan? */
export function seTraslapan(
  aIni: Date,
  aFin: Date,
  bIni: Date,
  bFin: Date,
): boolean {
  // Se traslapan si cada uno empieza antes de que el otro termine.
  // Tocarse en el borde exacto (aFin == bIni) NO cuenta como traslape.
  return aIni.getTime() < bFin.getTime() && bIni.getTime() < aFin.getTime();
}

/** Clave de día calendario (YYYY-MM-DD, hora local) para agrupar por día. */
export function claveDia(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** ¿Dos fechas caen en el mismo día calendario? */
export function mismoDia(a: Date, b: Date): boolean {
  return claveDia(a) === claveDia(b);
}

/** Inicio (00:00:00) del día de la fecha dada. */
export function inicioDelDia(fecha: Date): Date {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Fin exclusivo del día (00:00:00 del día siguiente). */
export function finDelDia(fecha: Date): Date {
  const d = inicioDelDia(fecha);
  d.setDate(d.getDate() + 1);
  return d;
}
