/**
 * Costo BRUTO de horas y ausencias de una persona en un periodo.
 *
 * Fórmula (la misma que se documenta en la pantalla /planilla):
 *   costo = horas_normales  x salario_hora
 *         + horas_extra_25  x salario_hora x 1.25
 *         + horas_extra_50  x salario_hora x 1.50
 *         + horas_extra_75  x salario_hora x 1.75
 *         + horas_extra_100 x salario_hora x 2.00
 *         + suma de costo_ausencia del periodo
 *
 * El multiplicador de una banda es `1 + porcentaje/100`, así que un porcentaje
 * configurado fuera de 25/50/75/100 (p. ej. 30 %) se cobra correctamente sin tocar
 * este código.
 *
 * ALCANCE: es costo BRUTO. No calcula deducciones (IHSS, RAP, INFOP, impuesto sobre
 * la renta) ni el neto a pagar. Antes de pagar con estos números, nómina debe validar
 * los multiplicadores contra el Código de Trabajo de Honduras y la política interna.
 */
import { redondearMonto, salarioHora } from "./salario";

export interface TotalesHoras {
  normales: number;
  extra25: number;
  extra50: number;
  extra75: number;
  extra100: number;
  /** Horas por porcentaje, incluidas bandas fuera de 25/50/75/100. */
  porRecargo: Record<number, number>;
}

export function totalesCero(): TotalesHoras {
  return { normales: 0, extra25: 0, extra50: 0, extra75: 0, extra100: 0, porRecargo: {} };
}

/** Multiplicador de una banda: 0 % da 1.00, 25 % da 1.25, 100 % da 2.00. */
export function multiplicador(porcentaje: number): number {
  return 1 + porcentaje / 100;
}

/** Costo de las horas trabajadas (sin ausencias). */
export function costoHoras(totales: TotalesHoras, salarioMensual: number | null): number {
  const tarifa = salarioHora(salarioMensual);
  if (tarifa <= 0) return 0;
  let costo = 0;
  for (const [pct, horas] of Object.entries(totales.porRecargo)) {
    costo += horas * tarifa * multiplicador(Number(pct));
  }
  return redondearMonto(costo);
}

/** Costo del SOBRETIEMPO solamente (las bandas con recargo, sin las horas normales). */
export function costoHorasExtra(
  totales: TotalesHoras,
  salarioMensual: number | null,
): number {
  const tarifa = salarioHora(salarioMensual);
  if (tarifa <= 0) return 0;
  let costo = 0;
  for (const [pct, horas] of Object.entries(totales.porRecargo)) {
    const p = Number(pct);
    if (p <= 0) continue;
    costo += horas * tarifa * multiplicador(p);
  }
  return redondearMonto(costo);
}

/** Costo total del periodo: horas + ausencias. */
export function costoPeriodo(
  totales: TotalesHoras,
  salarioMensual: number | null,
  costoAusencias: number,
): number {
  return redondearMonto(costoHoras(totales, salarioMensual) + costoAusencias);
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Suma dos juegos de totales (para acumular por persona, por puesto o del periodo). */
export function sumarTotales(a: TotalesHoras, b: TotalesHoras): TotalesHoras {
  const porRecargo: Record<number, number> = { ...a.porRecargo };
  for (const [pct, horas] of Object.entries(b.porRecargo)) {
    const k = Number(pct);
    porRecargo[k] = r2((porRecargo[k] ?? 0) + horas);
  }
  return {
    normales: r2(a.normales + b.normales),
    extra25: r2(a.extra25 + b.extra25),
    extra50: r2(a.extra50 + b.extra50),
    extra75: r2(a.extra75 + b.extra75),
    extra100: r2(a.extra100 + b.extra100),
    porRecargo,
  };
}

/** Convierte lo que devuelve calcularHorasTurno al acumulador de totales. */
export function totalesDeFila(fila: {
  horas_normales: number;
  horas_extra_25: number;
  horas_extra_50: number;
  horas_extra_75: number;
  horas_extra_100: number;
}): TotalesHoras {
  return {
    normales: fila.horas_normales,
    extra25: fila.horas_extra_25,
    extra50: fila.horas_extra_50,
    extra75: fila.horas_extra_75,
    extra100: fila.horas_extra_100,
    porRecargo: {
      0: fila.horas_normales,
      25: fila.horas_extra_25,
      50: fila.horas_extra_50,
      75: fila.horas_extra_75,
      100: fila.horas_extra_100,
    },
  };
}
