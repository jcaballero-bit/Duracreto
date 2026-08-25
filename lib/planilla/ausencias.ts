/**
 * Tipos de ausencia y el costo que se SUGIERE para cada uno.
 *
 * El costo sugerido es solo eso: la pantalla lo propone y el Administrador lo puede
 * cambiar (hay incapacidades que el IHSS cubre en parte, permisos que se pagan por
 * excepción, etc.). Lo que se guarda es el valor final que quedó en la celda.
 */
import { salarioDiario } from "./salario";

export const TIPOS_AUSENCIA = [
  "Vacaciones",
  "Permiso_Sin_Goce",
  "Incapacidad",
  "Otro",
] as const;

export type TipoAusencia = (typeof TIPOS_AUSENCIA)[number];

export const ETIQUETA_AUSENCIA: Record<TipoAusencia, string> = {
  Vacaciones: "Vacaciones",
  Permiso_Sin_Goce: "Permiso sin goce",
  Incapacidad: "Incapacidad",
  Otro: "Otro",
};

export function esTipoAusencia(v: string): v is TipoAusencia {
  return (TIPOS_AUSENCIA as readonly string[]).includes(v);
}

export function etiquetaAusencia(v: string): string {
  return esTipoAusencia(v) ? ETIQUETA_AUSENCIA[v] : v;
}

/**
 * Costo sugerido de un día de ausencia:
 *  · Vacaciones e Incapacidad → el salario diario completo (día pagado).
 *  · Permiso sin goce → 0.
 *  · Otro → 0 (que el Administrador decida).
 */
export function costoSugeridoAusencia(
  tipo: TipoAusencia,
  salarioMensual: number | null | undefined,
): number {
  if (tipo === "Vacaciones" || tipo === "Incapacidad") {
    return Math.round(salarioDiario(salarioMensual) * 100) / 100;
  }
  return 0;
}
