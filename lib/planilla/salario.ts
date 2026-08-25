/**
 * Derivación del salario. La BASE que se guarda es el sueldo MENSUAL
 * (`operadores.salario_mensual`), que es como se pacta; el diario y el horario se
 * derivan siempre con estas dos fórmulas, en un solo lugar:
 *
 *   salario_diario = salario_mensual / 30      (mes de 30 días, práctica de nómina)
 *   salario_hora   = salario_diario / 8        (jornada ordinaria de 8 h)
 *                  = salario_mensual / 240
 *
 * DATO SENSIBLE: estos valores solo se muestran en /planilla (Administrador).
 */
export const DIAS_MES_NOMINA = 30;
export const HORAS_JORNADA_ORDINARIA = 8;

/** Salario diario derivado del mensual. */
export function salarioDiario(salarioMensual: number | null | undefined): number {
  if (!salarioMensual || salarioMensual <= 0) return 0;
  return salarioMensual / DIAS_MES_NOMINA;
}

/** Salario por hora derivado del mensual (mensual / 30 / 8). */
export function salarioHora(salarioMensual: number | null | undefined): number {
  return salarioDiario(salarioMensual) / HORAS_JORNADA_ORDINARIA;
}

/** Redondeo a 2 decimales para montos en lempiras. */
export function redondearMonto(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Formato de moneda para pantalla (no se usa para cálculo). */
export function textoLempiras(v: number): string {
  return `L ${v.toLocaleString("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
