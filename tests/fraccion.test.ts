// Revenimiento escrito en FRACCIONES: en obra se dicta "5 3/4", no 5.75.
import { describe, expect, it } from "vitest";
import { formatearRevenimiento, parsearRevenimiento } from "@/lib/calidad/fraccion";

describe("parsearRevenimiento", () => {
  it("lee entero + fracción con espacio o con guion", () => {
    expect(parsearRevenimiento("5 3/4")).toBe(5.75);
    expect(parsearRevenimiento("5-3/4")).toBe(5.75);
    expect(parsearRevenimiento("4 1/2")).toBe(4.5);
    expect(parsearRevenimiento("6 1/8")).toBe(6.125);
  });

  it("lee solo la fracción", () => {
    expect(parsearRevenimiento("3/4")).toBe(0.75);
    expect(parsearRevenimiento("1/2")).toBe(0.5);
  });

  it("lee enteros y decimales, con coma o punto", () => {
    expect(parsearRevenimiento("5")).toBe(5);
    expect(parsearRevenimiento("5.75")).toBe(5.75);
    expect(parsearRevenimiento("5,75")).toBe(5.75);
  });

  it("tolera las comillas de pulgada y los espacios de más", () => {
    expect(parsearRevenimiento('5 3/4"')).toBe(5.75);
    expect(parsearRevenimiento("  5 3/4  ")).toBe(5.75);
    expect(parsearRevenimiento("5 3 / 4")).toBe(5.75);
  });

  it("vacío es null (sin dato) y la basura es undefined (dato inválido)", () => {
    expect(parsearRevenimiento("")).toBeNull();
    expect(parsearRevenimiento("   ")).toBeNull();
    expect(parsearRevenimiento("cinco")).toBeUndefined();
    expect(parsearRevenimiento("5 3/")).toBeUndefined();
    expect(parsearRevenimiento("5/0")).toBeUndefined();
    expect(parsearRevenimiento("-3")).toBeUndefined();
  });
});

describe("formatearRevenimiento", () => {
  it("escribe el número como se lee en obra", () => {
    expect(formatearRevenimiento(5.75)).toBe('5 3/4"');
    expect(formatearRevenimiento(4.5)).toBe('4 1/2"');
    expect(formatearRevenimiento(6.125)).toBe('6 1/8"');
    expect(formatearRevenimiento(0.75)).toBe('3/4"');
    expect(formatearRevenimiento(5)).toBe('5"');
  });

  it("un valor que no cae en octavos se muestra con decimales, sin inventar fracción", () => {
    expect(formatearRevenimiento(5.3)).toBe('5.3"');
  });

  it("sin dato muestra una raya", () => {
    expect(formatearRevenimiento(null)).toBe("—");
    expect(formatearRevenimiento(undefined)).toBe("—");
  });

  it("ida y vuelta: lo que se escribe es lo que se lee", () => {
    for (const txt of ["5 3/4", "4 1/2", "6 1/8", "3/4", "7"]) {
      const n = parsearRevenimiento(txt);
      expect(typeof n).toBe("number");
      expect(formatearRevenimiento(n as number).replace(/"/g, "")).toBe(txt);
    }
  });
});
