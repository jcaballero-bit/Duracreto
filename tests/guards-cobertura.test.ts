// Toda página protegida se autentica ELLA MISMA en el servidor.
//
// Por qué esta prueba existe: el `middleware.ts` redirige a /login sin sesión, pero es
// una Edge Function que se factura POR INVOCACIÓN y corre en cada request de página. Es
// la única capa que se podría retirar para bajar el consumo del plan gratuito… y solo se
// puede retirar si NINGUNA página depende de ella. Hoy las 23 se protegen solas; esta
// prueba lo mantiene así, de modo que la decisión de quitar el middleware sea una
// decisión y no una apuesta.
//
// No sustituye al middleware: mientras esté, es defensa en profundidad. Lo que impide es
// que una página NUEVA nazca dependiendo de él sin que nadie se dé cuenta.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Rutas de todos los `page.tsx` bajo app/. */
function paginas(dir = "app", out: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) paginas(ruta, out);
    else if (entrada === "page.tsx") out.push(ruta);
  }
  return out;
}

/**
 * Formas válidas de exigir sesión en el servidor:
 *  · `requerirAcceso(...)`  — el guard normal (rol + zona + contraseña al día).
 *  · `exigirAdmin()`        — pantallas solo de Administrador.
 *  · `alcanceActual()`      — el panel, que decide qué mostrar según el alcance.
 *  · `await auth()`         — /configuracion, que solo exige estar logueado.
 */
const GUARDS = /requerirAcceso|exigirAdmin|exigirGestionFlota|alcanceActual|await auth\(\)/;

/**
 * Páginas PÚBLICAS a propósito. Agregar algo aquí es una decisión explícita: cualquier
 * ruta de esta lista es alcanzable sin sesión si algún día se quita el middleware.
 */
const PUBLICAS = new Set(["app/login/page.tsx"]);

describe("cobertura de guards en las páginas", () => {
  it("cada página o se protege sola, o está declarada pública", () => {
    const sinGuard = paginas()
      .map((p) => p.replace(/\\/g, "/"))
      .filter((p) => !PUBLICAS.has(p))
      .filter((p) => !GUARDS.test(readFileSync(p, "utf8")));

    expect(
      sinGuard,
      `Estas páginas dependerían del middleware para no ser públicas:\n  ${sinGuard.join("\n  ")}`,
    ).toEqual([]);
  });

  it("hay páginas de verdad (la prueba no pasa por no encontrar nada)", () => {
    // Sin esto, un cambio de estructura que rompiera el recorrido dejaría la prueba en
    // verde sin revisar nada.
    expect(paginas().length).toBeGreaterThanOrEqual(20);
  });

  it("la única página pública declarada es el login", () => {
    expect([...PUBLICAS]).toEqual(["app/login/page.tsx"]);
  });
});
