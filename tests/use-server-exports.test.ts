// Un archivo `"use server"` no puede RE-EXPORTAR tipos.
//
// Este es un punto ciego real de las dos compuertas del proyecto, comprobado:
//
//   export const X = 7;            → `next build` FALLA con "Only async functions are
//                                    allowed to be exported in a 'use server' file". Bien.
//   export type { X };             → `tsc` pasa, `next build` PASA… y la pantalla revienta
//                                    en runtime con `ReferenceError: X is not defined`.
//
// La causa: el loader de acciones de Next genera un re-export por CADA export que
// encuentra en el archivo y lo trata como VALOR. Un `export type { X }` se convierte en
// `export { X }`, y como el tipo no existe en tiempo de ejecución, el módulo entero falla
// al evaluarse — con lo cual dejan de funcionar TODAS las acciones de ese archivo, no
// solo la que usa el tipo.
//
// Ya pasó: `app/planilla/actions.ts` re-exportaba `DatosAsistencia` y con eso no se podía
// guardar el salario de un operador. Esta prueba es la única red que lo atrapa.
//
// Lo que SÍ se puede: declarar el tipo en el propio archivo (`export interface X {}`,
// `export type X = …`). TypeScript los borra por completo, así que nunca llegan al
// JavaScript emitido y el loader no los ve. Hay siete archivos así y funcionan.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Todos los .ts/.tsx de app/ y lib/. */
function fuentes(dir: string, out: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      if (entrada === "generated" || entrada === "node_modules") continue;
      fuentes(ruta, out);
    } else if (/\.tsx?$/.test(entrada)) out.push(ruta);
  }
  return out;
}

/** Archivos con la directiva `"use server"` al inicio. */
function archivosServer(): string[] {
  return [...fuentes("app"), ...fuentes("lib")].filter((f) =>
    /^\s*["']use server["'];/.test(readFileSync(f, "utf8")),
  );
}

/**
 * Re-exports de tipo: `export type { X }` y `export { type X }`. Son los que se cuelan.
 * No se marcan las DECLARACIONES (`export type X = …`, `export interface X`), que sí
 * están permitidas porque no sobreviven a la compilación.
 */
const RE_EXPORT_TIPO = [
  /^\s*export\s+type\s*\{/m, // export type { X }
  /^\s*export\s*\{[^}]*\btype\s+\w/m, // export { type X, ... }
];

describe('exports de los archivos "use server"', () => {
  it("ninguno re-exporta un tipo", () => {
    const malos: string[] = [];
    for (const f of archivosServer()) {
      const src = readFileSync(f, "utf8");
      if (RE_EXPORT_TIPO.some((re) => re.test(src))) malos.push(f.replace(/\\/g, "/"));
    }
    expect(
      malos,
      "Un re-export de tipo en un archivo 'use server' rompe TODAS sus acciones en " +
        "runtime, y ni tsc ni next build lo detectan. Quita el re-export y que cada " +
        "consumidor importe el tipo de su módulo original:\n  " +
        malos.join("\n  "),
    ).toEqual([]);
  });

  it("el detector reconoce las dos formas peligrosas y no marca las válidas", () => {
    // Sin esto, un cambio en la expresión regular dejaría la prueba en verde sin revisar
    // nada — el fallo silencioso que ya nos costó una pantalla.
    const marca = (src: string) => RE_EXPORT_TIPO.some((re) => re.test(src));
    // Peligrosas.
    expect(marca('"use server";\nexport type { DatosAsistencia };')).toBe(true);
    expect(marca('"use server";\nexport { type Datos, guardar };')).toBe(true);
    // Válidas: declaraciones que TypeScript borra.
    expect(marca('"use server";\nexport interface Datos { a: string }')).toBe(false);
    expect(marca('"use server";\nexport type Datos = Record<string, string>;')).toBe(false);
    expect(marca('"use server";\nexport async function guardar() {}')).toBe(false);
  });

  it("hay archivos 'use server' de verdad (la prueba no pasa por no encontrar nada)", () => {
    expect(archivosServer().length).toBeGreaterThanOrEqual(10);
  });
});
