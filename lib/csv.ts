// Utilidades CSV (puras) compartidas por el importador y sus pruebas.
//
// La plantilla se genera para abrir EN COLUMNAS en Excel: BOM (tildes), la
// directiva `sep=;` (Excel respeta el separador en cualquier locale) y saltos
// CRLF. El parser autodetecta el separador (coma o punto y coma) y quita el BOM,
// de modo que la MISMA plantilla descargada se puede volver a subir.

export const DELIM_PLANTILLA = ";";
const BOM = "﻿";

/** Genera el contenido de la plantilla (solo encabezados) para Excel. */
export function generarPlantilla(columnas: string[]): string {
  return `${BOM}sep=${DELIM_PLANTILLA}\r\n${columnas.join(DELIM_PLANTILLA)}\r\n`;
}

/** Parsea CSV con comillas dobles, BOM y separador autodetectado (`,` o `;`). */
export function parseCSV(texto: string): Record<string, string>[] {
  let t = texto.replace(/\r\n?/g, "\n");
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); // quita BOM de Excel

  let delim = ",";
  const sep = t.match(/^sep=(.)\n/i); // directiva de Excel
  if (sep) {
    delim = sep[1];
    t = t.slice(sep[0].length);
  } else {
    const primera = t.split("\n", 1)[0] ?? "";
    const comas = (primera.match(/,/g) ?? []).length;
    const puntoYComa = (primera.match(/;/g) ?? []).length;
    if (puntoYComa > comas) delim = ";";
  }

  const filas: string[][] = [];
  let campo = "";
  let fila: string[] = [];
  let enComillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (enComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else enComillas = false;
      } else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === delim) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  const noVacias = filas.filter((f) => f.some((x) => x.trim() !== ""));
  if (noVacias.length === 0) return [];
  const encabezados = noVacias[0].map((h) => h.trim());
  return noVacias.slice(1).map((f) => {
    const obj: Record<string, string> = {};
    encabezados.forEach((h, idx) => (obj[h] = (f[idx] ?? "").trim()));
    return obj;
  });
}
