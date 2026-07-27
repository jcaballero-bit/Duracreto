// Orden de PRESENTACIÓN de los planteles (solo visual, no afecta la lógica).
// Lo definió el negocio; los planteles no listados van al final, alfabéticos.
const ORDEN_PRESENTACION = [
  "santa marta",
  "choloma",
  "villanueva",
  "puerto cortes",
  "la ceiba",
  "tegucigalpa",
  "hazama",
];

const DIACRITICOS = new RegExp("[\\u0300-\\u036f]", "g");

function normalizar(nombre: string): string {
  return nombre.normalize("NFD").replace(DIACRITICOS, "").trim().toLowerCase();
}

/** Índice de orden de un plantel por su nombre (para ordenar los grupos en UI). */
export function ordenPlantel(nombre: string): number {
  const i = ORDEN_PRESENTACION.indexOf(normalizar(nombre));
  return i === -1 ? ORDEN_PRESENTACION.length : i;
}

/** Comparador de grupos por nombre de plantel según el orden de presentación. */
export function compararPlanteles(a: string, b: string): number {
  return ordenPlantel(a) - ordenPlantel(b) || a.localeCompare(b);
}
