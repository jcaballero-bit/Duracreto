// Validación del volumen de captura.
//
// Estas pruebas SUSTITUYEN a las que verificaban el paso obligatorio de 0.5 m³ (y la
// exención del Administrador). Ese comportamiento se eliminó a pedido del usuario: en
// obra los volúmenes reales no caen en múltiplos de medio metro, y forzar el redondeo
// desviaba el dato hacia los m³ suministrados y las métricas comerciales.
import { describe, expect, it } from "vitest";
import { DECIMALES_VOLUMEN, normalizarVolumen, validarVolumen } from "@/lib/volumen";

describe("validarVolumen", () => {
  it("acepta cualquier decimal, sin paso obligatorio", () => {
    // Los casos que ANTES se rechazaban por no ser múltiplos de 0.5.
    expect(validarVolumen(2.2)).toBeNull();
    expect(validarVolumen(7.3)).toBeNull();
    expect(validarVolumen(6.7)).toBeNull();
    expect(validarVolumen(6.25)).toBeNull();
    expect(validarVolumen(0.1)).toBeNull();
  });

  it("acepta los valores redondos de siempre", () => {
    expect(validarVolumen(6.5)).toBeNull();
    expect(validarVolumen(7)).toBeNull();
    expect(validarVolumen(60)).toBeNull();
  });

  it("no depende del rol: la regla es la misma para todos", () => {
    // La firma ya no recibe `esAdmin`. Si alguien la vuelve a acoplar al rol, esta
    // prueba no compila — que es justamente la señal que se quiere.
    expect(validarVolumen.length).toBe(1);
  });

  it("rechaza cero, negativos y lo que no es un número", () => {
    expect(validarVolumen(0)).toMatch(/mayor que 0/i);
    expect(validarVolumen(-3)).toMatch(/mayor que 0/i);
    expect(validarVolumen(Number.NaN)).toMatch(/no es un número/i);
    expect(validarVolumen(Number.POSITIVE_INFINITY)).toMatch(/no es un número/i);
  });
});

describe("normalizarVolumen", () => {
  it("conserva dos decimales", () => {
    expect(DECIMALES_VOLUMEN).toBe(2);
    expect(normalizarVolumen(2.2)).toBe(2.2);
    expect(normalizarVolumen(6.75)).toBe(6.75);
    expect(normalizarVolumen(6.789)).toBe(6.79);
  });

  it("corta la cola binaria de sumar decimales", () => {
    // 0.1 + 0.2 = 0.30000000000000004 en punto flotante: eso NO debe llegar a la
    // base ni a un total mostrado.
    expect(normalizarVolumen(0.1 + 0.2)).toBe(0.3);
    expect(normalizarVolumen(2.2 + 7.3)).toBe(9.5);
  });
});
