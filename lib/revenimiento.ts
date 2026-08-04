// Opciones compartidas de la proyección/pedido. El revenimiento es un rango de
// asentamiento del concreto; el tipo de servicio distingue entregas normales de
// servicio de construcción. Se usan en el Programa Semana y en el formulario de
// pedido (donde el revenimiento es editable por Programador/Jefe de Planta).

export const REVENIMIENTOS = [
  '3" a 4"',
  '4" a 5"',
  '5" a 6"',
  '6" a 7"',
  '7" a 8"',
  '8" a 9"',
  '9" a 10"',
];

export const TIPOS_SERVICIO = ["Normal", "Servicio de Construcción"];

/**
 * ¿El diseño de mezcla (por su código) aplica al tipo de servicio elegido?
 *  - "Normal": códigos que empiezan con "C" o "Pre".
 *  - "Servicio de Construcción": códigos que empiezan con "Ser".
 *  - Sin tipo de servicio (vacío/null): no se filtra (todos aplican).
 * Comparación sin distinción de mayúsculas/minúsculas.
 */
export function disenoAplicaTipoServicio(
  codigo: string,
  tipoServicio: string | null | undefined,
): boolean {
  const t = (tipoServicio ?? "").trim();
  if (!t) return true;
  const c = (codigo ?? "").trim().toLowerCase();
  if (t === "Servicio de Construcción") return c.startsWith("ser");
  if (t === "Normal") return c.startsWith("c") || c.startsWith("pre");
  return true;
}
