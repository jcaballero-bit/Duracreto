// Columnas esperadas por catálogo para importar CSV. Módulo PLANO (sin
// "use server") para poder importarlo tanto en el cliente (plantilla + lista)
// como en la acción de importación del servidor.
import type { Catalogo } from "./catalogos-actions";

// Las relaciones se referencian por NOMBRE (no por id) para que el CSV sea
// llenable a mano: plantel/plantel_base/hub por nombre de plantel, operador por
// nombre, asesor por nombre.
export const COLUMNAS_ESPERADAS: Record<Catalogo, string[]> = {
  planteles: ["nombre", "zona", "capacidad_dosificacion_m3h", "hub"],
  plantas: ["nombre", "plantel", "capacidad_m3h"],
  mixers: ["identificador", "placa", "marca", "capacidad_m3", "plantel_base", "estado", "operador"],
  bombas: ["identificador", "estado", "plantel_base"],
  camiones: ["identificador", "placa", "estado", "plantel_base"],
  pickups: ["identificador", "placa", "estado", "plantel_base"],
  operadores: ["nombre", "estado"],
  asesores: ["nombre", "correo"],
  disenos: ["codigo", "resistencia", "tamano_agregado", "revenimiento", "aditivo"],
};

const DIACRITICOS = new RegExp("[\\u0300-\\u036f]", "g");

/** Normaliza un encabezado: minúsculas, sin tildes, espacios/símbolos → "_". */
export function normalizarEncabezado(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .trim()
    .replace(/[\s./-]+/g, "_");
}
