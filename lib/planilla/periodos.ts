/**
 * Periodos de pago catorcenales, calculados a partir de un ANCLA.
 *
 * Módulo PURO: la navegación de la pantalla (anterior/siguiente) no depende de que la
 * fila exista en la base — el periodo se calcula, y se crea en la BD solo cuando hace
 * falta guardarle un estado. Así nunca hay un hueco entre catorcenas.
 *
 * Regla: 14 días exactos (fin = inicio + 13) y el pago 6 días después del cierre
 * (pago = fin + 6). Ancla: 06-jul-2026 → 19-jul-2026, se paga el 25-jul-2026.
 * El Administrador puede ajustar a mano un periodo específico (la fila de la BD manda
 * sobre el cálculo cuando existe).
 */
export const DIAS_PERIODO = 14;
export const DIAS_REZAGO_PAGO = 6;

/** Ancla del calendario de catorcenas (mes 0-based: 6 = julio). */
export const ANCLA = { anio: 2026, mes: 6, dia: 6 } as const;

export interface PeriodoPago {
  /** Índice respecto al ancla: 0 = el periodo ancla, 1 = el siguiente, -1 = el anterior. */
  indice: number;
  inicio: Date;
  fin: Date;
  pago: Date;
}

const MS_DIA = 86_400_000;

/** Fecha a medianoche local (quita la hora, que no importa para un periodo). */
export function aDia(f: Date): Date {
  return new Date(f.getFullYear(), f.getMonth(), f.getDate(), 0, 0, 0, 0);
}

function sumarDias(f: Date, dias: number): Date {
  return new Date(f.getFullYear(), f.getMonth(), f.getDate() + dias, 0, 0, 0, 0);
}

/** Días completos entre dos fechas, contados sobre el calendario (sin husos). */
function diasEntre(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / MS_DIA);
}

/** El periodo número `indice` contado desde el ancla. */
export function periodoPorIndice(indice: number): PeriodoPago {
  const ancla = new Date(ANCLA.anio, ANCLA.mes, ANCLA.dia, 0, 0, 0, 0);
  const inicio = sumarDias(ancla, indice * DIAS_PERIODO);
  const fin = sumarDias(inicio, DIAS_PERIODO - 1);
  const pago = sumarDias(fin, DIAS_REZAGO_PAGO);
  return { indice, inicio, fin, pago };
}

/** Índice del periodo que contiene una fecha (puede ser negativo). */
export function indicePorFecha(fecha: Date): number {
  const ancla = new Date(ANCLA.anio, ANCLA.mes, ANCLA.dia, 0, 0, 0, 0);
  return Math.floor(diasEntre(ancla, fecha) / DIAS_PERIODO);
}

/** El periodo que contiene una fecha. */
export function periodoQueContiene(fecha: Date): PeriodoPago {
  return periodoPorIndice(indicePorFecha(fecha));
}

/** Los 14 días del periodo, en orden. */
export function diasDelPeriodo(p: PeriodoPago): Date[] {
  return Array.from({ length: DIAS_PERIODO }, (_, i) => sumarDias(p.inicio, i));
}

const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/** "06 jul – 19 jul 2026" (si cambia de año lo indica en ambos extremos). */
export function etiquetaPeriodo(p: PeriodoPago): string {
  const dm = (f: Date) => `${String(f.getDate()).padStart(2, "0")} ${MESES[f.getMonth()]}`;
  if (p.inicio.getFullYear() !== p.fin.getFullYear()) {
    return `${dm(p.inicio)} ${p.inicio.getFullYear()} – ${dm(p.fin)} ${p.fin.getFullYear()}`;
  }
  return `${dm(p.inicio)} – ${dm(p.fin)} ${p.fin.getFullYear()}`;
}

/** "sáb 25 jul 2026" para la fecha de pago. */
export function fechaLarga(f: Date): string {
  const dias = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  return `${dias[f.getDay()]} ${String(f.getDate()).padStart(2, "0")} ${MESES[f.getMonth()]} ${f.getFullYear()}`;
}
