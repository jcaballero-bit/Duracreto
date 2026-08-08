// Config del motor que vive en BD (editable desde Administración), con fallback a un
// default en código. Hoy: el margen mínimo de hueco del motor de 2 pasadas.
import { prisma } from "@/lib/prisma";

export const CLAVE_MARGEN_HUECO = "margen_minimo_hueco_min";
export const MARGEN_HUECO_DEFAULT = 10; // minutos

/** Margen mínimo (min) de un hueco para ofrecerlo al relleno automático. Lee la
 *  config de BD; si no existe o es inválida, usa el default. Nunca lanza. */
export async function leerMargenHueco(): Promise<number> {
  try {
    const fila = await prisma.configuracion.findUnique({ where: { clave: CLAVE_MARGEN_HUECO } });
    const v = fila?.valor_int;
    return typeof v === "number" && v >= 0 ? v : MARGEN_HUECO_DEFAULT;
  } catch {
    return MARGEN_HUECO_DEFAULT;
  }
}
