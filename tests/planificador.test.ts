// Pruebas PURAS del planificador de combinación de capacidades (sin BD).
import { describe, expect, it } from "vitest";
import { planificarCombinacion } from "@/lib/motor/planificador";

/** Multiset de capacidades del plan, ordenado, para comparar sin importar orden. */
function capacidades(volumen: number, sizes: number[]): number[] {
  return planificarCombinacion(volumen, sizes)
    .viajes.map((v) => v.capacidad)
    .sort((a, b) => a - b);
}

describe("planificarCombinacion — mejor combinación (min viajes → min sobrante → menos grandes)", () => {
  it("16 m³ con 9 y 7 → exactamente 1×9 + 1×7 (2 viajes, sin sobrante)", () => {
    const r = planificarCombinacion(16, [9, 7]);
    expect(r.viajes).toHaveLength(2);
    expect(capacidades(16, [9, 7])).toEqual([7, 9]);
    expect(r.volumenSinCubrir).toBe(0);
  });

  it("18 m³ con 9 y 7 → 2×9 (2 viajes, cero sobrante) y no 9+7+parcial", () => {
    const r = planificarCombinacion(18, [9, 7]);
    expect(r.viajes).toHaveLength(2);
    expect(capacidades(18, [9, 7])).toEqual([9, 9]);
  });

  it("14 m³ con 9 y 7 → 2×7 (no 9 + parcial de 5): mismos 2 viajes, sin carga parcial", () => {
    const r = planificarCombinacion(14, [9, 7]);
    expect(r.viajes).toHaveLength(2);
    expect(capacidades(14, [9, 7])).toEqual([7, 7]);
    // Ambos viajes van llenos (7+7 = 14 exacto).
    expect(r.viajes.every((v) => v.volumen === 7)).toBe(true);
  });

  it("un volumen que cabe en una sola unidad usa un único viaje parcial", () => {
    const r = planificarCombinacion(10, [11, 7]);
    expect(r.viajes).toHaveLength(1);
    expect(r.viajes[0].capacidad).toBe(11);
    expect(r.viajes[0].volumen).toBe(10);
  });

  it("minimiza el número de viajes usando primero las capacidades grandes", () => {
    // 22 m³ con 11 → 2 viajes completos de 11.
    const r = planificarCombinacion(22, [11]);
    expect(r.viajes).toHaveLength(2);
    expect(r.viajes.every((v) => v.volumen === 11)).toBe(true);
  });

  it("con una sola capacidad, repite esa capacidad tantas veces como haga falta", () => {
    // 21 m³ con solo 7 → 3 viajes de 7 (el motor los serializa en los mixers que existan).
    const r = planificarCombinacion(21, [7]);
    expect(capacidades(21, [7])).toEqual([7, 7, 7]);
    expect(r.volumenSinCubrir).toBe(0);
  });

  it("prefiere la combinación de MENOR sobrante a igualdad de viajes", () => {
    // 25 m³ con 11/9/7: 9+9+7 = 25 exacto (0 sobrante) gana a 11+11+parcial.
    expect(capacidades(25, [11, 9, 7])).toEqual([7, 9, 9]);
  });

  it("SIN ninguna capacidad disponible reporta todo el volumen sin cubrir", () => {
    const r = planificarCombinacion(30, []);
    expect(r.viajes).toHaveLength(0);
    expect(r.volumenSinCubrir).toBe(30);
  });
});
