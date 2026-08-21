// m³ realmente DESPACHADOS de un programa, para el reporte de control de calidad.
//
// Vive aparte de `app/calidad/actions.ts` porque ese módulo es `"use server"` y solo
// puede exportar funciones async; esto es una función pura que usan tanto la acción
// (para el valor por defecto al guardar) como la página (para mostrarlo).

/**
 * Suma del volumen de los viajes en estado Completado, tomando el volumen REAL
 * cuando el despachador lo corrigió (`volumen_real_m3`) y el programado si no.
 * Es el valor por defecto de "m³ colocados"; el laboratorista puede ajustarlo.
 */
export function volumenDespachadoDe(
  viajes: { estado: string; volumen_asignado_m3: number; volumen_real_m3?: number | null }[],
): number {
  const n = viajes
    .filter((v) => v.estado === "Completado")
    .reduce((s, v) => s + (v.volumen_real_m3 ?? v.volumen_asignado_m3), 0);
  return Math.round(n * 100) / 100;
}
