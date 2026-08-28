// Búsqueda del desplegable de "Elemento" (pura).
//
// Lo que se protege: que el asesor ENCUENTRE lo que ya existe. Una coincidencia que no
// aparece termina en el mismo elemento escrito de dos maneras, que es justo lo que el
// catálogo viene a evitar.
import { describe, expect, it } from "vitest";
import { esElementoNuevo, filtrarElementos, normalizarBusqueda } from "@/lib/elementos";

const CATALOGO = [
  "Acera",
  "Cimentación",
  "Columnas",
  "Losa",
  "Losa de entrepiso",
  "Muro de contención",
  "Pavimento",
  "Piso industrial",
];

describe("normalizarBusqueda", () => {
  it("ignora acentos, mayúsculas y espacios de sobra", () => {
    expect(normalizarBusqueda("  CIMENTACIÓN  ")).toBe("cimentacion");
    expect(normalizarBusqueda("Muro de Contención")).toBe("muro de contencion");
  });

  it("la ñ también se pliega a n, y eso es lo que se quiere", () => {
    // NFD descompone la ñ en n + tilde combinante, que cuenta como diacrítico. El efecto
    // es una búsqueda más tolerante: teclear "caneria" encuentra "Cañería" y al revés,
    // que es como se escribe rápido y desde el celular. Solo afecta la COMPARACIÓN: el
    // valor que se guarda y se muestra conserva su ñ.
    expect(normalizarBusqueda("Cañería")).toBe("caneria");
    expect(filtrarElementos(["Cañería de aguas"], "caneria")).toEqual(["Cañería de aguas"]);
    expect(esElementoNuevo(["Cañería"], "caneria")).toBe(false);
  });
});

describe("filtrarElementos", () => {
  it("sin texto devuelve la lista completa (el desplegable también sirve para ver qué hay)", () => {
    expect(filtrarElementos(CATALOGO, "")).toEqual(CATALOGO);
    expect(filtrarElementos(CATALOGO, "   ")).toEqual(CATALOGO);
  });

  it("encuentra sin acentos: 'cimentacion' halla 'Cimentación'", () => {
    expect(filtrarElementos(CATALOGO, "cimentacion")).toEqual(["Cimentación"]);
    expect(filtrarElementos(CATALOGO, "CONTENCION")).toEqual(["Muro de contención"]);
  });

  it("primero las que EMPIEZAN con lo escrito, después las que solo lo contienen", () => {
    // "Losa" y "Losa de entrepiso" empiezan con "lo"; "Muro…" no lo contiene.
    expect(filtrarElementos(CATALOGO, "lo")).toEqual(["Losa", "Losa de entrepiso"]);
    // "entrepiso" solo aparece en medio.
    expect(filtrarElementos(CATALOGO, "entrepiso")).toEqual(["Losa de entrepiso"]);
    // "piso" empieza en ninguno y está en medio de dos: el orden respeta el catálogo.
    expect(filtrarElementos(CATALOGO, "piso")).toEqual(["Piso industrial", "Losa de entrepiso"]);
  });

  it("sin coincidencias devuelve vacío (la pantalla lo dice, no inventa)", () => {
    expect(filtrarElementos(CATALOGO, "helipuerto")).toEqual([]);
  });

  it("no muta el catálogo recibido", () => {
    const copia = [...CATALOGO];
    filtrarElementos(CATALOGO, "lo");
    expect(CATALOGO).toEqual(copia);
  });
});

describe("esElementoNuevo", () => {
  it("avisa cuando lo escrito no está en el catálogo", () => {
    expect(esElementoNuevo(CATALOGO, "Rampa de acceso")).toBe(true);
  });

  it("NO avisa por una diferencia de acento o mayúsculas", () => {
    // Sin esto, escribir "losa" sobre un catálogo que dice "Losa" anunciaría un elemento
    // nuevo que en realidad ya existe.
    expect(esElementoNuevo(CATALOGO, "losa")).toBe(false);
    expect(esElementoNuevo(CATALOGO, "CIMENTACION")).toBe(false);
    expect(esElementoNuevo(CATALOGO, "  Muro de contencion ")).toBe(false);
  });

  it("un campo vacío no es un elemento nuevo", () => {
    expect(esElementoNuevo(CATALOGO, "")).toBe(false);
    expect(esElementoNuevo(CATALOGO, "   ")).toBe(false);
  });

  it("con el catálogo vacío, cualquier texto es nuevo (y se puede escribir igual)", () => {
    expect(esElementoNuevo([], "Losa")).toBe(true);
    expect(filtrarElementos([], "Losa")).toEqual([]);
  });
});
