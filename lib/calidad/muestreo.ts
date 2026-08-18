// Instrucciones de MUESTREO del laboratorio (testigos / cilindros de concreto).
// Módulo puro: lo comparten la server action y la pantalla. No puede vivir en el
// archivo de acciones porque un módulo "use server" solo exporta funciones async.

/** Dónde se elaboran los testigos de concreto de un programa. */
export const UBICACIONES_MUESTRAS = ["En obra", "En planta"] as const;
export type UbicacionMuestras = (typeof UBICACIONES_MUESTRAS)[number];

/** Tope de cilindros por programa: evita un tecleo absurdo, no es una regla de negocio. */
export const MAX_MUESTRAS = 99;

/** ¿Es una ubicación válida? (vacío = sin definir, se acepta para limpiar el campo). */
export function esUbicacionMuestrasValida(valor: string): boolean {
  return valor === "" || (UBICACIONES_MUESTRAS as readonly string[]).includes(valor);
}

/** ¿La cantidad de muestras es válida? null = sin definir. */
export function esCantidadMuestrasValida(valor: number | null): boolean {
  if (valor == null) return true;
  return Number.isInteger(valor) && valor >= 0 && valor <= MAX_MUESTRAS;
}

/** Texto para mostrar la instrucción de muestreo (o un guion si no está definida). */
export function textoMuestreo(ubicacion: string | null, cantidad: number | null): string {
  if (!ubicacion && cantidad == null) return "Sin definir";
  const partes: string[] = [];
  if (cantidad != null) partes.push(`${cantidad} ${cantidad === 1 ? "cilindro" : "cilindros"}`);
  if (ubicacion) partes.push(ubicacion.toLowerCase());
  return partes.join(" · ");
}
