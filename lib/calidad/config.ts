// Configuración del control de calidad. La unidad de temperatura del concreto es
// CONFIGURABLE aquí (un solo lugar): cambia estos valores si se mide en otra unidad.
// Es solo de presentación (la BD guarda el número); no se persiste la unidad.
export const UNIDAD_TEMPERATURA = "°C"; // "°C" (grados Celsius)

/** Texto de una temperatura con su unidad (o "—" si no hay lectura). */
export function textoTemperatura(valor: number | null | undefined): string {
  if (valor == null) return "—";
  return `${valor} ${UNIDAD_TEMPERATURA}`;
}

/** Texto de un revenimiento en obra en pulgadas (o "—"). */
export function textoRevenimiento(valor: number | null | undefined): string {
  if (valor == null) return "—";
  return `${valor}"`;
}
