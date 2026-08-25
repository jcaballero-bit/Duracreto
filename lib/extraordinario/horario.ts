/**
 * Horario normal de una planta y clasificación de un despacho.
 *
 * OJO con la distinción, que es la parte que se confunde:
 *  · `configuracion_recargos` (Parte A) son bandas de LEY LABORAL y aplican a las
 *    PERSONAS: dicen cuánto se paga una hora.
 *  · `horario_normal_planta` (este módulo) es la JORNADA OPERATIVA de la planta y
 *    aplica a los DESPACHOS: dice si un viaje salió dentro o fuera de horario.
 * Coinciden por defecto (07:00-15:00), pero se configuran por separado y una planta
 * puede cerrar a otra hora que su vecina.
 *
 * Módulo PURO: recibe los horarios y las bandas ya leídos.
 */
import type { BandaRecargo, TipoDia } from "@/lib/planilla/recargos";
import { textoMin, tipoDiaDe } from "@/lib/planilla/recargos";

export interface HorarioPlanta {
  plantaId: number;
  tipoDia: TipoDia;
  aperturaMin: number;
  cierreMin: number;
  activo: boolean;
}

/** Minutos transcurridos del día (precisión al minuto). */
export function minutosDelDia(f: Date): number {
  return f.getHours() * 60 + f.getMinutes();
}

/**
 * Horario normal de una planta para el tipo de día de esa fecha. Devuelve null si no
 * hay franja activa configurada, y eso significa "sin horario normal": todo ese día es
 * extraordinario (es el caso del domingo, que a propósito no lleva fila precargada).
 */
export function horarioDe(
  plantaId: number,
  fecha: Date,
  horarios: HorarioPlanta[],
): HorarioPlanta | null {
  const tipo = tipoDiaDe(fecha);
  return (
    horarios.find((h) => h.plantaId === plantaId && h.tipoDia === tipo && h.activo) ?? null
  );
}

/**
 * ¿El viaje salió fuera del horario normal de SU planta? La hora de salida es el
 * criterio (el momento en que el camión dejó la planta). Sin franja activa para ese
 * tipo de día, todo es extraordinario.
 *
 * El cierre es el límite: una salida exactamente a la hora de cierre ya es
 * extraordinaria (a las 15:00 la jornada normal terminó), igual que una salida
 * anterior a la apertura.
 */
export function esExtraordinario(salida: Date, horario: HorarioPlanta | null): boolean {
  if (!horario) return true;
  const m = minutosDelDia(salida);
  return m < horario.aperturaMin || m >= horario.cierreMin;
}

/**
 * Porcentaje de recargo de LEY que corresponde al instante de la salida (0, 25, 50,
 * 75, 100…). El volumen del viaje se atribuye completo a la banda donde cae su salida:
 * un viaje es un punto en el tiempo, no un intervalo, así que no se reparte.
 *
 * Sin banda configurada para ese instante devuelve 0 (se trata como hora normal, igual
 * que en el cálculo de planilla).
 */
export function porcentajeDeRecargo(salida: Date, bandas: BandaRecargo[]): number {
  const tipo = tipoDiaDe(salida);
  const m = minutosDelDia(salida);
  const banda = bandas.find(
    (b) => b.tipoDia === tipo && m >= b.desdeMin && m < b.hastaMin,
  );
  return banda?.porcentaje ?? 0;
}

/** "07:00 a 15:00" o "sin horario normal" para mostrar con qué se clasificó. */
export function textoHorario(horario: HorarioPlanta | null): string {
  if (!horario) return "sin horario normal";
  return `${textoMin(horario.aperturaMin)} a ${textoMin(horario.cierreMin)}`;
}
