/**
 * Lector del archivo que exporta el reloj biométrico.
 *
 * POR QUÉ NO SE USA SheetJS
 * -------------------------
 * El archivo tiene extensión `.xls` pero NO es un `.xlsx` (ZIP) ni un `.xls` moderno
 * (contenedor OLE2, que empieza con D0 CF 11 E0). Es un **flujo BIFF crudo**: una
 * secuencia de registros `[tipo:2][largo:2][cuerpo:largo]` sin contenedor, con un BOF
 * de opcode 0x0809 (estilo BIFF5) pero **celdas en formato BIFF2** (`LABEL` = 0x0004).
 *
 * En el archivo real analizado (810 filas, 29 columnas) las 23,519 celdas son TODAS
 * `LABEL`: hasta las fechas ("17/8/2026") y las horas ("06:42") vienen como texto. No
 * hay un solo registro numérico, así que este lector solo necesita entender un tipo de
 * registro.
 *
 * Por eso no se agregó una dependencia: SheetJS no está instalado en el proyecto (el
 * registro corporativo bloquea `npm install`, igual que pasó con Leaflet, que hubo que
 * traer a mano a `public/vendor`), y vendorizar ~1 MB de librería fuera del gestor de
 * paquetes para leer un formato de un solo tipo de registro es más riesgo que este
 * archivo de ~100 líneas, que además queda cubierto por pruebas.
 *
 * Si algún día el reloj cambia y exporta un formato distinto, `leerHojaBiff` lo detecta
 * por su firma y devuelve un mensaje claro en vez de fallar de forma silenciosa.
 */

/** Registro de celda de texto en BIFF2. */
const LABEL_BIFF2 = 0x0004;
/** Registro de celda de texto en BIFF3/4 (por si el reloj cambia de versión). */
const LABEL_BIFF3 = 0x0204;
/** Inicio de libro/hoja. */
const BOF_BIFF2 = 0x0009;
const BOF_BIFF5 = 0x0809;

export interface HojaLeida {
  /** Matriz de celdas ya como texto: `filas[fila][columna]`. Sin celda = "". */
  filas: string[][];
  /** Cuántos registros de celda se leyeron (para el reporte). */
  celdas: number;
}

export class ArchivoNoSoportado extends Error {}

/** Decodifica bytes latin-1/cp1252 (lo que escribe el reloj) a texto. */
function texto(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/**
 * Reconoce formatos que este lector NO entiende y explica qué hacer, en vez de devolver
 * una hoja vacía (que se vería como "el archivo no tenía datos").
 */
function detectarFormatoAjeno(d: Uint8Array): string | null {
  const empieza = (...bytes: number[]) => bytes.every((b, i) => d[i] === b);
  if (empieza(0x50, 0x4b)) {
    return "El archivo es un .xlsx (paquete ZIP), no el formato que exporta el reloj. Exporta de nuevo desde el reloj sin abrirlo ni volverlo a guardar en Excel.";
  }
  if (empieza(0xd0, 0xcf, 0x11, 0xe0)) {
    return "El archivo es un .xls moderno (contenedor OLE2), no el formato crudo que exporta el reloj. Probablemente se abrió en Excel y se volvió a guardar; usa el archivo original del reloj.";
  }
  const cabeza = texto(d.slice(0, 200)).toLowerCase();
  if (cabeza.includes("<html") || cabeza.includes("<table") || cabeza.includes("<?xml")) {
    return "El archivo es HTML o XML con extensión .xls, no el formato que exporta el reloj.";
  }
  return null;
}

/**
 * Lee el flujo BIFF y devuelve la hoja como matriz de texto.
 *
 * Recorre los registros de principio a fin y se queda solo con las celdas de texto;
 * todo lo demás (fuentes, formatos, anchos de columna, encabezado de impresión) se
 * ignora porque no aporta datos.
 *
 * Cuerpo del registro LABEL en BIFF2: fila(2) col(2) atributos(3) largo(1) caracteres.
 * En BIFF3/4 los atributos son 2 bytes y el largo 2, así que se soportan ambos.
 */
export function leerHojaBiff(datos: Uint8Array): HojaLeida {
  if (datos.length < 4) throw new ArchivoNoSoportado("El archivo está vacío.");

  const ajeno = detectarFormatoAjeno(datos);
  if (ajeno) throw new ArchivoNoSoportado(ajeno);

  const vista = new DataView(datos.buffer, datos.byteOffset, datos.byteLength);
  const primerTipo = vista.getUint16(0, true);
  if (primerTipo !== BOF_BIFF2 && primerTipo !== BOF_BIFF5 && primerTipo !== 0x0209 && primerTipo !== 0x0409) {
    throw new ArchivoNoSoportado(
      "El archivo no parece ser el que exporta el reloj (no empieza con un registro de inicio de hoja).",
    );
  }

  const celdas = new Map<number, Map<number, string>>();
  let total = 0;
  let maxFila = -1;
  let maxCol = -1;

  let i = 0;
  while (i + 4 <= datos.length) {
    const tipo = vista.getUint16(i, true);
    const largo = vista.getUint16(i + 2, true);
    // Relleno de ceros al final del archivo: no es un registro.
    if (tipo === 0 && largo === 0) break;
    const inicio = i + 4;
    if (inicio + largo > datos.length) break; // registro truncado: se corta aquí

    if (tipo === LABEL_BIFF2 || tipo === LABEL_BIFF3) {
      const fila = vista.getUint16(inicio, true);
      const col = vista.getUint16(inicio + 2, true);
      // BIFF2 trae 3 bytes de atributos y 1 de largo; BIFF3/4, 2 y 2.
      const desplazamiento = tipo === LABEL_BIFF2 ? 7 : 6;
      const largoTexto =
        tipo === LABEL_BIFF2
          ? datos[inicio + desplazamiento]
          : vista.getUint16(inicio + desplazamiento, true);
      const desdeTexto = inicio + desplazamiento + (tipo === LABEL_BIFF2 ? 1 : 2);
      const valor = texto(datos.slice(desdeTexto, desdeTexto + largoTexto)).trim();

      let f = celdas.get(fila);
      if (!f) {
        f = new Map();
        celdas.set(fila, f);
      }
      f.set(col, valor);
      total += 1;
      if (fila > maxFila) maxFila = fila;
      if (col > maxCol) maxCol = col;
    }

    i = inicio + largo;
  }

  if (total === 0) {
    throw new ArchivoNoSoportado(
      "El archivo se leyó pero no trae celdas de texto. Verifica que sea el reporte de asistencia del reloj.",
    );
  }

  const filas: string[][] = [];
  for (let f = 0; f <= maxFila; f++) {
    const fila = celdas.get(f);
    const salida: string[] = [];
    for (let c = 0; c <= maxCol; c++) salida.push(fila?.get(c) ?? "");
    filas.push(salida);
  }

  return { filas, celdas: total };
}
