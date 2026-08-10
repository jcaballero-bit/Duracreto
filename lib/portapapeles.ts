// Parseo PURO de datos pegados desde el portapapeles. Excel y Google Sheets copian
// las celdas separadas por TABULACIONES y las filas por saltos de línea. Devuelve una
// matriz fila×columna de strings (sin recortar espacios internos, solo el salto final).
export function parsePortapapeles(texto: string): string[][] {
  let t = texto.replace(/\r\n?/g, "\n");
  // Quita un único salto de línea final (Excel suele agregarlo) para no crear una
  // fila vacía extra.
  if (t.endsWith("\n")) t = t.slice(0, -1);
  if (t === "") return [];
  return t.split("\n").map((linea) => linea.split("\t"));
}
