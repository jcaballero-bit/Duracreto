// Hora de APERTURA de planta: a partir de qué hora se puede empezar a cargar.
//
// Dos niveles, de más general a más específico:
//  1. Por defecto: 7:00 a.m. Editable desde Administración (clave `hora_apertura_min`
//     en `configuracion`), no fija en el código.
//  2. Excepción por DÍA y PLANTA (`aperturas_planta`): para un vaciado grande que
//     arranca a las 5:00 a.m. Es un dato por día, no una config global que haya que
//     cambiar y devolver a su lugar.
//
// Solo se usa para AVISAR (el modo manual nunca bloquea): si un cálculo hacia atrás
// deja la carga antes de la apertura, se le dice al usuario cuál es la hora mínima.

import { prisma } from "@/lib/prisma";
import { inicioDelDia } from "./tiempos";

export const CLAVE_HORA_APERTURA = "hora_apertura_min";
/** 7:00 a.m. en minutos desde medianoche. */
export const HORA_APERTURA_DEFAULT_MIN = 7 * 60;

// ── Helpers puros ────────────────────────────────────────────────────────────

/** Minutos transcurridos desde la medianoche local de esa fecha. */
export function minutosDesdeMedianoche(fecha: Date): number {
  return fecha.getHours() * 60 + fecha.getMinutes();
}

/** Instante (ms) de la apertura `minutos` en el día de `fecha`. */
export function msDeApertura(fecha: Date, minutos: number): number {
  return inicioDelDia(fecha).getTime() + minutos * 60_000;
}

/** "07:00" a partir de los minutos desde medianoche. */
export function textoHoraMin(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "HH:MM" → minutos desde medianoche, o null si no es válido. */
export function minutosDeTexto(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

// ── Lectura desde BD ─────────────────────────────────────────────────────────

/** Apertura por defecto (minutos). Si la config no existe o es inválida, 7:00. */
export async function leerAperturaDefault(): Promise<number> {
  try {
    const fila = await prisma.configuracion.findUnique({
      where: { clave: CLAVE_HORA_APERTURA },
    });
    const v = fila?.valor_int;
    return typeof v === "number" && v >= 0 && v < 24 * 60 ? v : HORA_APERTURA_DEFAULT_MIN;
  } catch {
    return HORA_APERTURA_DEFAULT_MIN;
  }
}

export interface AperturaVigente {
  /** Minutos desde medianoche a partir de los cuales se puede cargar ese día. */
  minutos: number;
  /** true si viene de una excepción de ese día/planta (no del valor por defecto). */
  esExcepcion: boolean;
}

/** Apertura vigente de una planta en un día: excepción del día si existe, si no la
 *  apertura por defecto. */
export async function leerAperturaPlanta(
  plantaId: number,
  fecha: Date,
): Promise<AperturaVigente> {
  const porDefecto = await leerAperturaDefault();
  try {
    const fila = await prisma.aperturas_planta.findUnique({
      where: { planta_id_fecha: { planta_id: plantaId, fecha: inicioDelDia(fecha) } },
      select: { hora_apertura_min: true },
    });
    if (fila) return { minutos: fila.hora_apertura_min, esExcepcion: true };
  } catch {
    // sin excepción legible → rige el default
  }
  return { minutos: porDefecto, esExcepcion: false };
}

/** Aperturas vigentes de varias plantas en un día (una consulta). Devuelve un mapa
 *  plantaId → apertura, con el default para las que no tienen excepción. */
export async function leerAperturasDeDia(
  plantaIds: number[],
  fecha: Date,
): Promise<Map<number, AperturaVigente>> {
  const porDefecto = await leerAperturaDefault();
  const mapa = new Map<number, AperturaVigente>(
    plantaIds.map((id) => [id, { minutos: porDefecto, esExcepcion: false }]),
  );
  if (plantaIds.length === 0) return mapa;
  const filas = await prisma.aperturas_planta.findMany({
    where: { planta_id: { in: plantaIds }, fecha: inicioDelDia(fecha) },
    select: { planta_id: true, hora_apertura_min: true },
  });
  for (const f of filas) {
    mapa.set(f.planta_id, { minutos: f.hora_apertura_min, esExcepcion: true });
  }
  return mapa;
}
