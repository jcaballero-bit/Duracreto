// Paso estándar de volumen para los pedidos. Los usuarios NO administradores solo
// pueden ingresar volúmenes múltiplos de este paso (0.5 m³); el Administrador puede
// ingresar CUALQUIER volumen (p. ej. 6.7 m³) para casos especiales. Se aplica en el
// input (atributo `step`) y se refuerza en el servidor.
export const PASO_VOLUMEN_M3 = 0.5;

/** ¿El volumen es múltiplo del paso estándar (0.5)? Tolerante a floats. */
export function volumenEsMultiploDePaso(v: number): boolean {
  if (!Number.isFinite(v)) return false;
  const pasos = v / PASO_VOLUMEN_M3;
  return Math.abs(pasos - Math.round(pasos)) < 1e-9;
}

/**
 * Valida un volumen según el rol. El Admin puede ingresar cualquier valor > 0; los
 * demás roles, solo múltiplos de 0.5. Devuelve un mensaje de error o null si es válido.
 */
export function validarVolumenPorRol(v: number, esAdmin: boolean): string | null {
  if (!(v > 0)) return "El volumen debe ser mayor que 0.";
  if (!esAdmin && !volumenEsMultiploDePaso(v)) {
    return "El volumen debe ser múltiplo de 0.5 m³. Solo un Administrador puede ingresar otros valores.";
  }
  return null;
}
