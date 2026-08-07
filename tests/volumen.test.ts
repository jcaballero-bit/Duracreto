// Restricción de volumen por rol: solo el Admin puede salir del paso de 0.5 m³.
import { describe, expect, it } from "vitest";
import { validarVolumenPorRol, volumenEsMultiploDePaso } from "@/lib/volumen";

describe("volumenEsMultiploDePaso", () => {
  it("acepta múltiplos de 0.5 y rechaza el resto", () => {
    expect(volumenEsMultiploDePaso(6.5)).toBe(true);
    expect(volumenEsMultiploDePaso(7)).toBe(true);
    expect(volumenEsMultiploDePaso(10)).toBe(true);
    expect(volumenEsMultiploDePaso(6.7)).toBe(false);
    expect(volumenEsMultiploDePaso(6.25)).toBe(false);
  });
});

describe("validarVolumenPorRol", () => {
  it("no-admin: solo múltiplos de 0.5", () => {
    expect(validarVolumenPorRol(6.5, false)).toBeNull();
    expect(validarVolumenPorRol(7, false)).toBeNull();
    expect(validarVolumenPorRol(6.7, false)).toMatch(/múltiplo de 0.5/i);
  });

  it("admin: cualquier volumen > 0", () => {
    expect(validarVolumenPorRol(6.7, true)).toBeNull();
    expect(validarVolumenPorRol(6.5, true)).toBeNull();
  });

  it("volumen <= 0 siempre inválido (incluido admin)", () => {
    expect(validarVolumenPorRol(0, true)).toMatch(/mayor que 0/i);
    expect(validarVolumenPorRol(-3, false)).toMatch(/mayor que 0/i);
  });
});
