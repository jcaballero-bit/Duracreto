// Validación del volumen de un pedido o de un viaje.
//
// **Cualquier valor decimal es válido** (2.2 m³, 7.3 m³, 6.75 m³), para todos los
// roles. Antes había un paso obligatorio de 0.5 m³ del que solo el Administrador
// quedaba exento; se quitó porque en obra los volúmenes reales no caen en múltiplos
// de medio metro y el redondeo obligado desviaba el dato: un pedido de 2.2 m³ se
// tenía que capturar como 2.0 o 2.5, y esa diferencia se arrastraba a los m³
// suministrados, a las métricas comerciales y a la facturación.
//
// La base de datos guarda estos campos como `Float` (`pedidos.volumen_total_m3`,
// `viajes.volumen_asignado_m3`, `viajes.volumen_real_m3`), así que soporta los
// decimales sin cambio de esquema.

/** Decimales que se conservan al capturar un volumen. */
export const DECIMALES_VOLUMEN = 2;

/**
 * Redondea a los decimales que se conservan, para no arrastrar cola binaria
 * (0.1 + 0.2 = 0.30000000000000004) hacia la base ni hacia los totales.
 */
export function normalizarVolumen(v: number): number {
  const f = 10 ** DECIMALES_VOLUMEN;
  return Math.round(v * f) / f;
}

/**
 * Valida un volumen de captura. Devuelve el mensaje de error, o `null` si es válido.
 *
 * La única regla es que sea un número mayor que 0: no hay paso obligatorio ni
 * restricción por rol.
 */
export function validarVolumen(v: number): string | null {
  if (!Number.isFinite(v)) return "El volumen no es un número válido.";
  if (!(v > 0)) return "El volumen debe ser mayor que 0.";
  return null;
}
