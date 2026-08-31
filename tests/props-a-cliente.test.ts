// Un componente SERVIDOR no puede pasarle FUNCIONES a uno cliente.
//
// Es un fallo de runtime puro: `tsc` lo acepta (los tipos calzan) y `next build` también,
// así que solo aparece al abrir la pantalla, con
// "Functions cannot be passed directly to Client Components".
//
// Ya costó dos veces en este proyecto: el calendario de producción (`hrefMes(mes)`) y la
// pantalla de producción histórica (`hrefAnio`). La solución siempre es la misma: pasar
// DATOS, no callbacks — la URL ya armada en vez de la función que la construye.
//
// Qué detecta esta prueba: en un archivo de servidor (sin la directiva "use client"), una
// prop cuyo valor es un identificador declarado como función EN ESE MISMO ARCHIVO, pasada
// a un componente que se importa de un módulo con "use client". No pretende cubrir todos
// los casos posibles —para eso haría falta un analizador de verdad— sino el patrón exacto
// que ya se cometió dos veces.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function fuentes(dir: string, out: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      if (entrada === "generated" || entrada === "node_modules") continue;
      fuentes(ruta, out);
    } else if (/\.tsx$/.test(entrada)) out.push(ruta);
  }
  return out;
}

const esCliente = (src: string) => /^\s*["']use client["'];/m.test(src.slice(0, 400));

/** Resuelve un import relativo o con alias `@/` a una ruta de archivo existente. */
function resolverModulo(desde: string, especificador: string): string | null {
  let base: string;
  if (especificador.startsWith("@/")) base = resolve(especificador.slice(2));
  else if (especificador.startsWith(".")) base = resolve(dirname(desde), especificador);
  else return null; // paquete de node_modules
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    try {
      const ruta = base + ext;
      if (statSync(ruta).isFile()) return ruta;
    } catch {
      /* sigue probando */
    }
  }
  return null;
}

/** Nombres exportados por cada import, con el archivo del que vienen. */
function importaciones(src: string, archivo: string): Map<string, string> {
  const mapa = new Map<string, string>();
  const re = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const destino = resolverModulo(archivo, m[2]);
    if (!destino) continue;
    for (const bruto of m[1].split(",")) {
      const nombre = bruto.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (nombre) mapa.set(nombre, destino);
    }
  }
  return mapa;
}

/**
 * Identificadores declarados como FUNCION en el archivo.
 *
 * No basta con ver que el valor empiece con `(`: `const x = (await f()).map(...)` es una
 * expresion entre parentesis, no una arrow function, y marcarla llenaria la prueba de
 * falsos positivos (paso con `elementos` en el Programa Semana). Hay que comprobar que los
 * parentesis CIERREN en `=>`.
 */
export function funcionesLocales(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/^\s*(?:async\s+)?function\s+(\w+)/gm)) out.add(m[1]);

  for (const m of src.matchAll(/^\s*const\s+(\w+)\s*(?::[^=\n]+)?=\s*(?:async\s+)?/gm)) {
    const nombre = m[1];
    let i = (m.index ?? 0) + m[0].length;
    if (src.startsWith("function", i)) {
      out.add(nombre);
      continue;
    }
    if (src[i] === "(") {
      // Se avanza hasta el parentesis que cierra, contando anidados.
      let nivel = 0;
      for (; i < src.length; i++) {
        if (src[i] === "(") nivel += 1;
        else if (src[i] === ")") {
          nivel -= 1;
          if (nivel === 0) {
            i += 1;
            break;
          }
        }
      }
      // Tras los parentesis puede venir un tipo de retorno antes de la flecha.
      if (/^\s*(?::[^=>]*)?=>/.test(src.slice(i, i + 120))) out.add(nombre);
      continue;
    }
    // `const f = x => ...`
    if (/^\w+\s*=>/.test(src.slice(i, i + 60))) out.add(nombre);
  }
  return out;
}

interface Hallazgo {
  archivo: string;
  componente: string;
  prop: string;
  funcion: string;
}

function revisar(archivo: string): Hallazgo[] {
  const src = readFileSync(archivo, "utf8");
  if (esCliente(src)) return []; // de cliente a cliente no hay problema

  const imports = importaciones(src, archivo);
  // Componentes importados que viven en un módulo "use client".
  const clientes = new Set<string>();
  for (const [nombre, destino] of imports) {
    if (!/^[A-Z]/.test(nombre)) continue; // solo componentes
    try {
      if (esCliente(readFileSync(destino, "utf8"))) clientes.add(nombre);
    } catch {
      /* el módulo no se pudo leer: se ignora */
    }
  }
  if (clientes.size === 0) return [];

  const locales = funcionesLocales(src);
  const hallazgos: Hallazgo[] = [];

  for (const comp of clientes) {
    // Bloque de la etiqueta: desde `<Comp` hasta el primer `>` de cierre de la apertura.
    for (const m of src.matchAll(new RegExp(`<${comp}\\b([\\s\\S]*?)/?>`, "g"))) {
      for (const p of m[1].matchAll(/(\w+)=\{(\w+)\}/g)) {
        if (locales.has(p[2])) {
          hallazgos.push({ archivo, componente: comp, prop: p[1], funcion: p[2] });
        }
      }
    }
  }
  return hallazgos;
}

describe("props que un componente servidor le pasa a uno cliente", () => {
  it("ninguno le pasa una FUNCIÓN", () => {
    const hallazgos = [...fuentes("app")].flatMap(revisar);
    const texto = hallazgos
      .map((h) => `${h.archivo.replace(/\\/g, "/")}: <${h.componente} ${h.prop}={${h.funcion}}>`)
      .join("\n  ");
    expect(
      hallazgos,
      "Pasar una función a un componente cliente revienta en runtime y ni tsc ni el " +
        "build lo detectan. Pasa el DATO ya calculado (la URL armada, no la función que " +
        "la construye):\n  " + texto,
    ).toEqual([]);
  });

  it("el detector reconoce el patrón exacto que ya costó dos veces", () => {
    // Sin esto, un cambio en las expresiones regulares dejaría la prueba en verde sin
    // revisar nada — el fallo silencioso que hace inútil una red de seguridad.
    const locales = funcionesLocales(
      [
        'const hrefAnio = (a: number) => "/x";',
        "function armar() {}",
        "const flecha = x => x + 1;",
        "const conTipo = (a: number): string => String(a);",
        "const dato = 5;",
        // El falso positivo que hay que NO marcar: una expresion entre parentesis.
        "const elementos = (await catalogo()).map((e) => e.nombre);",
        "const lista = (datos ?? []).filter(Boolean);",
      ].join("\n"),
    );
    expect(locales.has("hrefAnio")).toBe(true);
    expect(locales.has("armar")).toBe(true);
    expect(locales.has("flecha")).toBe(true);
    expect(locales.has("conTipo")).toBe(true);
    expect(locales.has("dato")).toBe(false);
    expect(locales.has("elementos"), "expresion entre parentesis, no una funcion").toBe(false);
    expect(locales.has("lista")).toBe(false);
  });

  it("hay archivos de servidor que revisar (no pasa por no encontrar nada)", () => {
    const conClientes = fuentes("app").filter((f) => {
      const src = readFileSync(f, "utf8");
      if (esCliente(src)) return false;
      for (const [nombre, destino] of importaciones(src, f)) {
        if (!/^[A-Z]/.test(nombre)) continue;
        try {
          if (esCliente(readFileSync(destino, "utf8"))) return true;
        } catch {
          /* ignora */
        }
      }
      return false;
    });
    expect(conClientes.length).toBeGreaterThanOrEqual(5);
  });
});
