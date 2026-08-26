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
  // La importación del reloj biométrico marca así las ausencias: el reloj sabe que la
  // persona no marcó, pero NO sabe por qué. Queda visible como pendiente para que quien
  // captura la clasifique; no se asume "Otro" ni se cuenta como jornada de cero horas.
  "Pendiente",
] as const;

export type TipoAusencia = (typeof TIPOS_AUSENCIA)[number];

export const ETIQUETA_AUSENCIA: Record<TipoAusencia, string> = {
  Vacaciones: "Vacaciones",
  Permiso_Sin_Goce: "Permiso sin goce",
  Incapacidad: "Incapacidad",
  Otro: "Otro",
  Pendiente: "Pendiente de clasificar",
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

/**
 * Una ausencia "Pendiente" no tiene costo decidido: se guarda con `costo_ausencia` en
 * NULL (no en 0) para que se distinga de un permiso sin goce ya clasificado en cero.
 */
export function requiereClasificar(tipo: string | null | undefined): boolean {
  return tipo === "Pendiente";
}
