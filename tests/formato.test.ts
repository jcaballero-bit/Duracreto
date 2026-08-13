// Prueba PURA del texto de control de temperatura (hielo) y la antigüedad relativa.
import { describe, expect, it } from "vitest";
import { textoHielo, tiempoRelativo } from "@/lib/formato";

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

describe("tiempoRelativo (antigüedad de solicitudes)", () => {
  const ahora = new Date("2026-08-12T12:00:00");
  const hace = (ms: number) => new Date(ahora.getTime() - ms);
  const MIN = 60_000;
  const HORA = 60 * MIN;
  const DIA = 24 * HORA;

  it("recién para < 45 s", () => {
    expect(tiempoRelativo(hace(10_000), ahora)).toBe("recién");
  });
  it("minutos, horas, días con singular/plural", () => {
    expect(tiempoRelativo(hace(5 * MIN), ahora)).toBe("hace 5 min");
    expect(tiempoRelativo(hace(2 * HORA), ahora)).toBe("hace 2 h");
    expect(tiempoRelativo(hace(1 * DIA), ahora)).toBe("hace 1 día");
    expect(tiempoRelativo(hace(3 * DIA), ahora)).toBe("hace 3 días");
  });
  it("meses y años", () => {
    expect(tiempoRelativo(hace(45 * DIA), ahora)).toBe("hace 1 mes");
    expect(tiempoRelativo(hace(400 * DIA), ahora)).toBe("hace 1 año");
  });
  it("acepta ISO string y devuelve '' para fecha nula/ inválida", () => {
    expect(tiempoRelativo(hace(2 * HORA).toISOString(), ahora)).toBe("hace 2 h");
    expect(tiempoRelativo(null, ahora)).toBe("");
    expect(tiempoRelativo("no-es-fecha", ahora)).toBe("");
  });
});
