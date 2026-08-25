/**
 * Clasificación de las horas de un turno por nivel de recargo.
 *
 * Es la ÚNICA función que reparte horas entre bandas: la planilla, el recálculo al
 * editar una hora y el reporte de horario extraordinario la llaman a ella, para que
 * no haya dos versiones de la misma regla.
 *
 * Cómo trabaja:
 *  1. Parte el turno por día calendario (si cruza medianoche, corta ahí).
 *  2. Para cada segmento determina el tipo de día (LunVie / Sábado / Domingo).
 *  3. Cruza el segmento contra las bandas de ese tipo de día y cuenta cuántos
 *     minutos caen en cada una.
 *  4. Acumula minutos por porcentaje a lo largo de todo el turno.
 *  5. Convierte minutos a horas con decimales (90 min = 1.5 h). NUNCA redondea a la
 *     hora completa.
 *
 * El nivel 0 % son horas normales; 25/50/75/100 % se reportan por separado, no
 * sumados. Si el Administrador configura un porcentaje distinto (p. ej. 30 %), no se
 * pierde: sale en `porRecargo`, que es lo que usa el cálculo de costo.
 */
import type { BandaRecargo, TipoDia } from "./recargos";
import { tipoDiaDe } from "./recargos";

export interface HorasTurno {
  horas_normales: number;
  horas_extra_25: number;
  horas_extra_50: number;
  horas_extra_75: number;
  horas_extra_100: number;
  /** Horas por porcentaje de recargo (clave = porcentaje). Incluye el 0 %. */
  porRecargo: Record<number, number>;
  /** Duración total del turno en minutos. */
  minutosTotales: number;
  /**
   * Minutos que no cayeron en ninguna banda configurada (hueco en la configuración).
   * Se cuentan como horas normales, pero se reportan para que el hueco se vea.
   */
  minutosSinBanda: number;
}

function vacio(): HorasTurno {
  return {
    horas_normales: 0,
    horas_extra_25: 0,
    horas_extra_50: 0,
    horas_extra_75: 0,
    horas_extra_100: 0,
    porRecargo: {},
    minutosTotales: 0,
    minutosSinBanda: 0,
  };
}

/** Minutos transcurridos del día (precisión al minuto; se ignoran los segundos). */
function minutosDelDia(f: Date): number {
  return f.getHours() * 60 + f.getMinutes();
}

/** Medianoche del día siguiente al de la fecha dada. */
function medianocheSiguiente(f: Date): Date {
  return new Date(f.getFullYear(), f.getMonth(), f.getDate() + 1, 0, 0, 0, 0);
}

/** Minutos a horas con 2 decimales (90 → 1.5). */
function aHoras(min: number): number {
  return Math.round((min / 60) * 100) / 100;
}

export function calcularHorasTurno(
  horaEntrada: Date | null | undefined,
  horaSalida: Date | null | undefined,
  bandas: BandaRecargo[],
): HorasTurno {
  if (!horaEntrada || !horaSalida) return vacio();
  if (horaSalida.getTime() <= horaEntrada.getTime()) return vacio();

  // Bandas agrupadas por tipo de día, ordenadas por hora de inicio.
  const porTipo = new Map<TipoDia, BandaRecargo[]>();
  for (const b of bandas) {
    const lista = porTipo.get(b.tipoDia) ?? [];
    lista.push(b);
    porTipo.set(b.tipoDia, lista);
  }
  for (const lista of porTipo.values()) lista.sort((a, b) => a.desdeMin - b.desdeMin);

  const minutosPorPorcentaje = new Map<number, number>();
  let minutosSinBanda = 0;
  let minutosTotales = 0;

  let cursor = new Date(horaEntrada.getTime());
  const fin = horaSalida;

  // Un paso por día calendario. El corte en medianoche es lo que permite que un turno
  // nocturno reparta sus horas entre el día que empieza y el que termina (p. ej. un
  // sábado que sigue hasta el domingo cambia de tipo de día a la medianoche).
  while (cursor.getTime() < fin.getTime()) {
    const corte = medianocheSiguiente(cursor);
    const finSegmento = corte.getTime() < fin.getTime() ? corte : fin;

    const desde = minutosDelDia(cursor);
    // Si el segmento termina exactamente en medianoche son los 1440 minutos del día
    // (getHours() daría 0 y el tramo mediría negativo).
    const hasta =
      finSegmento.getTime() === corte.getTime() ? 1440 : minutosDelDia(finSegmento);

    const tipo = tipoDiaDe(cursor);
    const lista = porTipo.get(tipo) ?? [];

    let cubiertos = 0;
    for (const banda of lista) {
      const ini = Math.max(desde, banda.desdeMin);
      const f = Math.min(hasta, banda.hastaMin);
      if (f <= ini) continue;
      const mins = f - ini;
      cubiertos += mins;
      minutosPorPorcentaje.set(
        banda.porcentaje,
        (minutosPorPorcentaje.get(banda.porcentaje) ?? 0) + mins,
      );
    }

    const duracion = hasta - desde;
    minutosTotales += duracion;
    // Lo que no cayó en ninguna banda se trata como hora normal (0 %), pero queda
    // contado aparte para poder avisar del hueco de configuración.
    const huecos = duracion - cubiertos;
    if (huecos > 0) {
      minutosSinBanda += huecos;
      minutosPorPorcentaje.set(0, (minutosPorPorcentaje.get(0) ?? 0) + huecos);
    }

    cursor = finSegmento;
  }

  const porRecargo: Record<number, number> = {};
  for (const [pct, mins] of minutosPorPorcentaje) porRecargo[pct] = aHoras(mins);

  return {
    horas_normales: porRecargo[0] ?? 0,
    horas_extra_25: porRecargo[25] ?? 0,
    horas_extra_50: porRecargo[50] ?? 0,
    horas_extra_75: porRecargo[75] ?? 0,
    horas_extra_100: porRecargo[100] ?? 0,
    porRecargo,
    minutosTotales,
    minutosSinBanda,
  };
}
