// Umbrales del reporte de tiempos de descarga, en BD (editables desde Administración)
// con fallback al default del código. Nunca lanza: un reporte no debe caerse porque
// falte una fila de configuración.
import { prisma } from "@/lib/prisma";
import { UMBRALES_DESCARGA_DEFAULT, type UmbralesDescarga } from "./descargas";

export const CLAVE_ESPERA = "umbral_espera_obra_min";
export const CLAVE_VARIABILIDAD = "umbral_variabilidad_intervalo_min";
/** Tolerancia en PORCENTAJE entero (25 = +25 %); el cálculo la usa como fracción. */
export const CLAVE_TOLERANCIA = "tolerancia_descarga_pct";

export async function leerUmbralesDescarga(): Promise<UmbralesDescarga> {
  try {
    const filas = await prisma.configuracion.findMany({
      where: { clave: { in: [CLAVE_ESPERA, CLAVE_VARIABILIDAD, CLAVE_TOLERANCIA] } },
      select: { clave: true, valor_int: true },
    });
    const v = (clave: string) => filas.find((f) => f.clave === clave)?.valor_int ?? null;
    const espera = v(CLAVE_ESPERA);
    const variabilidad = v(CLAVE_VARIABILIDAD);
    const tolerancia = v(CLAVE_TOLERANCIA);
    return {
      esperaMin: espera != null && espera > 0 ? espera : UMBRALES_DESCARGA_DEFAULT.esperaMin,
      variabilidadMin:
        variabilidad != null && variabilidad > 0
          ? variabilidad
          : UMBRALES_DESCARGA_DEFAULT.variabilidadMin,
      toleranciaPct:
        tolerancia != null && tolerancia >= 0
          ? tolerancia / 100
          : UMBRALES_DESCARGA_DEFAULT.toleranciaPct,
    };
  } catch {
    return UMBRALES_DESCARGA_DEFAULT;
  }
}
