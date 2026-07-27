// ─────────────────────────────────────────────────────────────────────────────
// Helpers puros de tiempo y duración. Sin acceso a BD: fáciles de probar.
// ─────────────────────────────────────────────────────────────────────────────
import {
  MIN_DESCARGA_POR_M3,
  MIN_DESCARGA_POR_M3_DEFAULT,
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
