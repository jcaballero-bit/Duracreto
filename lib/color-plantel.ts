// Color FIJO y determinista por plantel (el mismo entre sesiones, recargas y pantallas).
//
// A diferencia de `color-asesor` y `color-cliente`, que derivan el color de un HASH del
// id, aquí el id se usa como ÍNDICE directo. La razón es el tamaño del conjunto: los
// planteles son 7 y se comparan ENTRE SÍ en el mismo gráfico, donde dos líneas del mismo
// color serían un error de lectura. Un hash de 7 ids en 12 ranuras choca con altísima
// probabilidad (paradoja del cumpleaños); el índice directo no choca nunca mientras los
// ids quepan en la paleta, y además da colores contrastantes a ids consecutivos porque la
// paleta está ordenada para eso.
//
// Límite conocido y aceptado: dos planteles cuyos ids difieran en exactamente 12 (p. ej.
// 1 y 13) compartirían color. Con una flota de 7 planteles administrados a mano eso no
// ocurre, y si algún día ocurre se amplía la paleta — no se cambia la regla, porque
// cambiarla repintaría los colores que los usuarios ya tienen memorizados.
//
// Los tonos son de saturación media: legibles sobre las superficies claras del sistema
// (la app es de tema claro) y también sobre un fondo oscuro, por si algún día se agrega.
const PALETA = [
  "#2563eb", // azul
  "#dc2626", // rojo
  "#16a34a", // verde
  "#d97706", // ámbar
  "#7c3aed", // violeta
  "#0891b2", // cian
  "#db2777", // rosa
  "#4d7c0f", // oliva
  "#ea580c", // naranja
  "#4f46e5", // índigo
  "#0d9488", // teal
  "#be123c", // carmesí
];

/** Color del TOTAL (una sola línea agregada): el azul marino de acento del sistema. */
export const COLOR_TOTAL = "#1e293b";

/** Color hex determinista para un plantel. */
export function colorPorPlantel(id: number): string {
  // `id - 1` para que el plantel 1 tome la primera entrada de la paleta. El módulo con
  // guarda de negativos deja la función total: nunca devuelve `undefined`.
  const i = ((((id - 1) % PALETA.length) + PALETA.length) % PALETA.length) | 0;
  return PALETA[i];
}

/** Cuántos colores distintos hay antes de que se repita alguno. */
export const COLORES_DISTINTOS = PALETA.length;
