// Generación del PDF del Programa DPCR-08 en el SERVIDOR (runtime Node).
// Une las tres piezas: snapshot (datos) → paginador (dónde corta cada hoja) →
// documento react-pdf (dibujo) y devuelve los bytes del archivo.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { paginarPrograma } from "./paginador";
import { ProgramaPdf, type LogoPdf } from "./pdf-doc";
import type { SnapshotPrograma } from "./snapshot";

/** Logo leído una sola vez por proceso (evita tocar el disco en cada PDF). */
let logoCache: LogoPdf | null | undefined;

/**
 * Logo de la empresa para el encabezado ISO. Si no se puede leer (archivo movido,
 * bundle sin `public/`), devuelve null y el documento cae al texto "DURACRETO": el
 * programa se genera igual, nunca se rompe por el logo.
 */
async function leerLogo(): Promise<LogoPdf | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    const ruta = path.join(process.cwd(), "public", "logo-duracreto.png");
    logoCache = { data: await readFile(ruta), format: "png" };
  } catch {
    logoCache = null;
  }
  return logoCache;
}

/**
 * Nombre de archivo del documento: `DPCR-08_13-08-2026_Zona-Norte_v3.pdf`.
 * La fecha va en DÍA-MES-AÑO (como se lee acá), no en el ISO interno.
 */
export function nombreArchivo(
  fecha: string, // "YYYY-MM-DD"
  zona: string,
  version: number | null,
): string {
  const [anio, mes, dia] = fecha.split("-");
  const fechaLegible = dia && mes && anio ? `${dia}-${mes}-${anio}` : fecha;
  const z = zona.replace(/\s+/g, "-");
  const v = version != null ? `_v${version}` : "_extracto";
  return `DPCR-08_${fechaLegible}_Zona-${z}${v}.pdf`;
}

/** Renderiza el PDF completo de un snapshot y devuelve sus bytes. */
export async function generarPdfPrograma(snap: SnapshotPrograma): Promise<Uint8Array> {
  const logo = await leerLogo();
  const paginas = paginarPrograma(snap);
  return renderToBuffer(
    ProgramaPdf({ snap: { ...snap, ...(logo ? { logo } : {}) }, paginas }),
  );
}
