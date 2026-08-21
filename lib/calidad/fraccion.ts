// Revenimiento en FRACCIONES: en obra y en planta se mide en pulgadas y se dicta
// como "5 3/4", no como 5.75. El laboratorista y el administrador lo escriben tal
// como lo miden y el sistema lo guarda como número (Float en `control_calidad_viaje`)
// para poder promediarlo y compararlo.
//
// Módulo PURO: se prueba con casos de mesa (tests/fraccion.test.ts).

/** Denominadores de pulgada que se usan en obra (nunca sale un 1/7). */
const DENOMINADORES = [2, 4, 8] as const;

/**
 * Lee un revenimiento escrito a mano y devuelve las pulgadas como número.
 * Acepta lo que la gente escribe de verdad:
 *   "5 3/4"  ·  "5-3/4"  ·  "5 3/4\""  ·  "3/4"  ·  "5"  ·  "5.75"  ·  "5,75"
 * Devuelve `null` si el campo va vacío y `undefined` si no se entiende (para que
 * quien llame distinga "sin dato" de "dato inválido").
 */
export function parsearRevenimiento(texto: string): number | null | undefined {
  const t = texto.trim().replace(/["″'']/g, "").replace(",", ".");
  if (t === "") return null;

  // "5 3/4" o "5-3/4" (entero + fracción)
  const mixto = /^(\d+)\s*[-\s]\s*(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (mixto) {
    const [, ent, num, den] = mixto;
    if (Number(den) === 0) return undefined;
    return Number(ent) + Number(num) / Number(den);
  }

  // "3/4" (solo fracción)
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) {
    const [, num, den] = frac;
    if (Number(den) === 0) return undefined;
    return Number(num) / Number(den);
  }

  // "5" o "5.75"
  const dec = /^\d+(\.\d+)?$/.exec(t);
  if (dec) return Number(t);

  return undefined;
}

/**
 * Escribe un revenimiento como se lee en obra: `5.75` → `5 3/4"`. Redondea al octavo
 * de pulgada más cercano (la precisión real del cono de Abrams); si el número no cae
 * en octavos —p. ej. un valor viejo capturado como 5.3— se muestra con decimales para
 * no inventar una fracción que no se midió.
 */
export function formatearRevenimiento(valor: number | null | undefined): string {
  if (valor == null || !Number.isFinite(valor)) return "—";
  const entero = Math.floor(valor);
  const resto = valor - entero;

  for (const den of DENOMINADORES) {
    const num = Math.round(resto * den);
    if (Math.abs(resto - num / den) > 1e-9) continue;
    if (num === 0) return `${entero}"`;
    if (num === den) return `${entero + 1}"`;
    return entero === 0 ? `${num}/${den}"` : `${entero} ${num}/${den}"`;
  }
  // No es un octavo exacto: se muestra el número tal cual (sin fracción inventada).
  return `${Number(valor.toFixed(2))}"`;
}
