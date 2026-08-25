// Derivación del salario y costo bruto del periodo (módulos PUROS).
//
// La fórmula se prueba con un salario que da números redondos (L 24,000 al mes = L 100
// la hora) para que el resultado esperado se pueda verificar a mano.
import { describe, expect, it } from "vitest";
import { costoSugeridoAusencia } from "@/lib/planilla/ausencias";
import {
  costoHoras,
  costoHorasExtra,
  costoPeriodo,
  multiplicador,
  sumarTotales,
  totalesDeFila,
  totalesCero,
} from "@/lib/planilla/costo";
import { salarioDiario, salarioHora } from "@/lib/planilla/salario";

const MENSUAL = 24_000; // L 800 al día, L 100 la hora

describe("derivación del salario", () => {
  it("diario = mensual / 30 y hora = diario / 8", () => {
    expect(salarioDiario(MENSUAL)).toBe(800);
    expect(salarioHora(MENSUAL)).toBe(100);
    expect(salarioHora(MENSUAL)).toBeCloseTo(MENSUAL / 240, 10);
  });

  it("sin salario capturado el costo es 0, no un error", () => {
    expect(salarioHora(null)).toBe(0);
    expect(salarioDiario(undefined)).toBe(0);
    expect(costoHoras(totalesDeFila({
      horas_normales: 8,
      horas_extra_25: 2,
      horas_extra_50: 0,
      horas_extra_75: 0,
      horas_extra_100: 0,
    }), null)).toBe(0);
  });
});

describe("costo del periodo", () => {
  it("cada nivel se paga con su multiplicador", () => {
    expect(multiplicador(0)).toBe(1);
    expect(multiplicador(25)).toBe(1.25);
    expect(multiplicador(50)).toBe(1.5);
    expect(multiplicador(75)).toBe(1.75);
    expect(multiplicador(100)).toBe(2);
  });

  it("8 h normales + 3.5 h al 25 % con L 100/h = L 1,237.50", () => {
    // 8 x 100 = 800 ; 3.5 x 100 x 1.25 = 437.50
    const totales = totalesDeFila({
      horas_normales: 8,
      horas_extra_25: 3.5,
      horas_extra_50: 0,
      horas_extra_75: 0,
      horas_extra_100: 0,
    });
    expect(costoHoras(totales, MENSUAL)).toBe(1237.5);
    // El sobretiempo por separado son solo las 3.5 h con recargo.
    expect(costoHorasExtra(totales, MENSUAL)).toBe(437.5);
  });

  it("un domingo completo de 8 h al 100 % cuesta el doble que la jornada normal", () => {
    const domingo = totalesDeFila({
      horas_normales: 0,
      horas_extra_25: 0,
      horas_extra_50: 0,
      horas_extra_75: 0,
      horas_extra_100: 8,
    });
    expect(costoHoras(domingo, MENSUAL)).toBe(1600); // 8 x 100 x 2
  });

  it("las ausencias del periodo se suman al costo de las horas", () => {
    const totales = totalesDeFila({
      horas_normales: 40,
      horas_extra_25: 0,
      horas_extra_50: 0,
      horas_extra_75: 0,
      horas_extra_100: 0,
    });
    expect(costoPeriodo(totales, MENSUAL, 1600)).toBe(5600); // 4000 + 1600
  });

  it("un porcentaje configurado fuera de 25/50/75/100 se cobra igual", () => {
    const totales = { ...totalesCero(), porRecargo: { 30: 10 } };
    expect(costoHoras(totales, MENSUAL)).toBe(1300); // 10 x 100 x 1.30
  });

  it("sumarTotales acumula por nivel sin mezclarlos", () => {
    const a = totalesDeFila({
      horas_normales: 8,
      horas_extra_25: 1,
      horas_extra_50: 0,
      horas_extra_75: 0,
      horas_extra_100: 0,
    });
    const b = totalesDeFila({
      horas_normales: 4.5,
      horas_extra_25: 0.5,
      horas_extra_50: 2,
      horas_extra_75: 0,
      horas_extra_100: 0,
    });
    const t = sumarTotales(a, b);
    expect(t.normales).toBe(12.5);
    expect(t.extra25).toBe(1.5);
    expect(t.extra50).toBe(2);
    expect(t.extra75).toBe(0);
    expect(t.extra100).toBe(0);
  });
});

describe("costo sugerido de una ausencia", () => {
  it("vacaciones e incapacidad sugieren el salario diario; el permiso sin goce, 0", () => {
    expect(costoSugeridoAusencia("Vacaciones", MENSUAL)).toBe(800);
    expect(costoSugeridoAusencia("Incapacidad", MENSUAL)).toBe(800);
    expect(costoSugeridoAusencia("Permiso_Sin_Goce", MENSUAL)).toBe(0);
    expect(costoSugeridoAusencia("Otro", MENSUAL)).toBe(0);
  });
});
