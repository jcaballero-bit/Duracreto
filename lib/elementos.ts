// Búsqueda del desplegable de "Elemento" (módulo PURO).
//
// Vive fuera del componente para poder probarla: el filtro decide qué ve el asesor
// mientras teclea, y una coincidencia que no aparece se traduce en un elemento escrito de
// dos maneras distintas — justo lo que el catálogo viene a evitar.

/**
 * Texto comparable: sin acentos, sin mayúsculas y sin espacios de sobra.
 *
 * Es lo que hace que teclear "cimentacion" encuentre "Cimentación". En una operación
 * donde se escribe rápido y desde el celular, exigir el acento sería exigir de más.
 */
export function normalizarBusqueda(t: string): string {
  return t
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Opciones que coinciden con lo escrito, ordenadas por utilidad: primero las que
 * EMPIEZAN con el texto y después las que solo lo contienen. Al teclear "lo" interesa más
 * "Losa" que "Muro de contención con losa".
 *
 * Sin texto devuelve la lista completa (el desplegable sirve también para ver qué hay).
 */
export function filtrarElementos(opciones: string[], texto: string): string[] {
  const q = normalizarBusqueda(texto);
  if (!q) return [...opciones];
  const empiezan: string[] = [];
  const contienen: string[] = [];
  for (const o of opciones) {
    const n = normalizarBusqueda(o);
    if (n.startsWith(q)) empiezan.push(o);
    else if (n.includes(q)) contienen.push(o);
  }
  return [...empiezan, ...contienen];
}

/**
 * ¿Lo escrito es un elemento que NO está en el catálogo?
 *
 * Se usa solo para avisar ("no está en la lista: se guardará tal como lo escribiste"), no
 * para bloquear: el campo es texto libre a propósito, porque en obra aparecen elementos
 * que nadie dio de alta. La comparación ignora acentos y mayúsculas, así que escribir
 * "losa" cuando existe "Losa" no se anuncia como nuevo.
 */
export function esElementoNuevo(opciones: string[], texto: string): boolean {
  const q = normalizarBusqueda(texto);
  if (q === "") return false;
  return !opciones.some((o) => normalizarBusqueda(o) === q);
}
