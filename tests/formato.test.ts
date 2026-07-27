// Prueba PURA del texto de control de temperatura (hielo).
import { describe, expect, it } from "vitest";
import { textoHielo } from "@/lib/formato";

describe("textoHielo", () => {
  it("0 o vacío → Sin Control de Temperatura", () => {
    expect(textoHielo(0)).toBe("Sin Control de Temperatura");
    expect(textoHielo(null)).toBe("Sin Control de Temperatura");
    expect(textoHielo(undefined)).toBe("Sin Control de Temperatura");
  });
  it("1-10 → Temp: N sacos/m³", () => {
    expect(textoHielo(1)).toBe("Temp: 1 sacos/m³");
    expect(textoHielo(3)).toBe("Temp: 3 sacos/m³");
    expect(textoHielo(10)).toBe("Temp: 10 sacos/m³");
  });
});
