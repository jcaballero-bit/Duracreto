// Cerrar sesión tiene que cerrar DE VERDAD, y entrar otro usuario en el mismo equipo
// no debe mezclar información.
//
// Las pantallas se usan en computadoras de planta que se relevan por turnos. La regla
// que fijó el usuario (sep-2026) es: **mientras no se cierre sesión, la sesión
// permanece abierta** —nada de vencimientos por inactividad, porque el personal de
// campo tiene el sistema instalado en el celular—, pero al cerrarla no puede quedar
// rastro de esa persona en el equipo.
//
// Son reglas de configuración y de cableado de las server actions, no de base de datos,
// así que se verifican leyendo las FUENTES — el mismo patrón que
// `tests/horarios-manual.test.ts` y `tests/guards-cobertura.test.ts`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = process.cwd();
const leer = (ruta: string) => readFileSync(join(raiz, ruta), "utf8");

/**
 * El archivo SIN comentarios.
 *
 * Hace falta: los comentarios explican POR QUÉ existe cada protección y por tanto citan
 * el código que la implementa, así que una búsqueda a secas encuentra la cita y da por
 * buena una fuente a la que le quitaron la llamada. Pasó al escribir estas pruebas: se
 * borró el `revalidatePath` y la prueba siguió en verde por el comentario.
 */
const codigo = (ruta: string) =>
  leer(ruta)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const CIERRE = "app/auth-actions.ts";
const INGRESO = "app/login/actions.ts";
const MENU = "app/components/user-menu.tsx";

describe("la sesión dura hasta que se cierre a mano", () => {
  it("NO se configura un vencimiento por inactividad", () => {
    // Decisión del usuario: el personal de campo usa el sistema instalado en el celular
    // y un plazo lo obligaría a iniciar sesión casi todas las mañanas. Además, el caso
    // que preocupaba —el relevo de turno en un equipo compartido— no lo resuelve un
    // plazo: ahí la máquina está en uso continuo y la sesión nunca vencería. Lo que ese
    // caso necesita es que cerrar sesión cierre de verdad (los describe de abajo).
    const config = codigo("auth.config.ts");
    expect(config).toMatch(/session:\s*\{\s*strategy:\s*"jwt"\s*\}/);
    expect(config).not.toMatch(/maxAge/);
    expect(codigo("auth.ts")).not.toMatch(/session:\s*\{[^}]*maxAge/);
  });
});

describe("cerrar sesión cierra de verdad", () => {
  it("borra la sesión en el SERVIDOR", () => {
    expect(codigo(CIERRE)).toMatch(/await signOut\(/);
  });

  it("borra la caché de router del navegador, y ANTES de salir", () => {
    // Sin esto, los RSC de las pantallas que recorrió el usuario siguen en memoria del
    // cliente y el router puede servírselas a quien entre después en ese equipo.
    const src = codigo(CIERRE);
    expect(src).toMatch(/revalidatePath\(\s*"\/"\s*,\s*"layout"\s*\)/);
    expect(src.indexOf("revalidatePath")).toBeLessThan(src.indexOf("signOut("));
  });

  it("sale con una RECARGA COMPLETA, no con el redirect del router", () => {
    // Una navegación del lado del cliente conserva el documento y la memoria de la
    // pestaña; `location.replace` pide /login como documento nuevo.
    const menu = codigo(MENU);
    expect(menu).toMatch(/window\.location\.replace\(\s*"\/login"\s*\)/);
    // Y la acción del servidor no debe redirigir ella misma (si lanzara el redirect, la
    // recarga del cliente no llegaría a ejecutarse).
    expect(codigo(CIERRE)).toMatch(/signOut\(\{\s*redirect:\s*false\s*\}\)/);
  });

  it("REEMPLAZA la entrada del historial, para que Atrás no vuelva a la sesión anterior", () => {
    const menu = codigo(MENU);
    expect(menu).toMatch(/location\.replace\(/);
    // `href =` o `assign()` agregarían una entrada y dejarían la pantalla anterior a un
    // botón Atrás de distancia.
    expect(menu).not.toMatch(/location\.href\s*=\s*"\/login"/);
    expect(menu).not.toMatch(/location\.assign\(/);
  });

  it("el botón de salir usa el handler que recarga, no la acción a secas", () => {
    // Si el form volviera a apuntar directo a la server action, se perdería la recarga.
    const menu = codigo(MENU);
    expect(menu).toMatch(/<form action=\{cerrarSesion\}/);
    expect(menu).not.toMatch(/<form action=\{cerrarSesionAction\}/);
  });
});

describe("entrar otro usuario en el mismo equipo no mezcla información", () => {
  it("iniciar sesión también invalida la caché, y antes del redirect", () => {
    // Cerrar sesión no siempre pasa por el botón (se cierra el navegador, se vence el
    // token), así que el ingreso es la otra oportunidad de limpiar lo que quedó.
    const src = codigo(INGRESO);
    expect(src).toMatch(/revalidatePath\(\s*"\/"\s*,\s*"layout"\s*\)/);
    expect(src.indexOf("revalidatePath")).toBeLessThan(src.indexOf('signIn("credentials"'));
  });

  it("los dos proveedores de ingreso invalidan (credenciales y Google)", () => {
    const src = codigo(INGRESO);
    const invalidaciones = [...src.matchAll(/revalidatePath\(/g)].length;
    const ingresos = [...src.matchAll(/await signIn\(/g)].length;
    expect(ingresos).toBeGreaterThan(0);
    expect(invalidaciones).toBe(ingresos);
  });

  it("la caché de catálogos del servidor no recibe datos de usuario", () => {
    // `unstable_cache` es GLOBAL: lo que entre ahí lo ven todos. Las funciones
    // cacheadas no deben tomar parámetros (un id de usuario, una zona, un plantel) ni
    // leer la sesión, porque eso sí filtraría datos de una persona a otra.
    const src = codigo("lib/catalogos-cache.ts");
    expect(src).not.toMatch(/\bauth\(\)/);
    expect(src).not.toMatch(/alcanceActual/);
    const cacheadas = [...src.matchAll(/unstable_cache\(\s*\n?\s*async\s*\(([^)]*)\)/g)];
    expect(cacheadas.length).toBeGreaterThan(0);
    for (const m of cacheadas) expect(m[1].trim()).toBe("");
  });

  it("el middleware sigue construyéndose con la config compartida", () => {
    // Es lo que exige sesión en TODAS las rutas: si dejara de usar `authConfig`, el
    // callback `authorized` no correría.
    expect(codigo("middleware.ts")).toMatch(/NextAuth\(authConfig\)/);
  });
});
