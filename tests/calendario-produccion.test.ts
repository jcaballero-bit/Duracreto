// Aritmética del calendario de producción (pruebas PURAS, sin BD).
import { describe, expect, it } from "vitest";
import {
  armarSemanas,
  cortesEscala,
  mesDesplazado,
  nivelDeVolumen,
  parsearMes,
  resumenMes,
  semanaIso,
  ymdLocal,
} from "@/lib/produccion/calendario";

describe("semanaIso", () => {
  it("usa la definición ISO-8601 (semana del primer jueves)", () => {
    // 1-ene-2026 es jueves → semana 1. El domingo anterior (28-dic-2025) sigue en la 52.
    expect(semanaIso(new Date(2026, 0, 1))).toBe(1);
    expect(semanaIso(new Date(2025, 11, 28))).toBe(52);
    // 19-ago-2026 (miércoles) cae en la semana 34.
    expect(semanaIso(new Date(2026, 7, 19))).toBe(34);
  });
});

describe("armarSemanas", () => {
  it("cubre el mes completo con filas de 7 días (domingo→sábado)", () => {
    const semanas = armarSemanas(2026, 8, new Map());
    for (const s of semanas) expect(s.dias).toHaveLength(7);
    // Agosto 2026: el 1 es sábado y el 31 lunes → la cuadrícula abarca 6 filas.
    expect(semanas[0].dias[6].iso).toBe("2026-08-01"); // primer sábado
    expect(semanas.at(-1)!.dias.some((d) => d.iso === "2026-08-31")).toBe(true);
    // Las celdas de relleno quedan marcadas como de otro mes (se dibujan vacías).
    expect(semanas[0].dias[0].delMes).toBe(false);
    expect(semanas[0].dias[6].delMes).toBe(true);
  });

  it("un día sin producción queda en 0 (la celda se dibuja vacía, no '0.00')", () => {
    const semanas = armarSemanas(2026, 8, new Map([["2026-08-03", { m3: 45, viajes: 5 }]]));
    const dias = semanas.flatMap((s) => s.dias).filter((d) => d.delMes);
    expect(dias.find((d) => d.iso === "2026-08-03")!.m3).toBe(45);
    expect(dias.filter((d) => d.m3 > 0)).toHaveLength(1);
    expect(dias.find((d) => d.iso === "2026-08-04")!.m3).toBe(0);
  });

  it("el total de la semana suma solo sus días", () => {
    const semanas = armarSemanas(
      2026,
      8,
      new Map([
        ["2026-08-03", { m3: 30, viajes: 3 }], // lunes, 2ª fila
        ["2026-08-04", { m3: 12.5, viajes: 2 }],
        ["2026-08-12", { m3: 20, viajes: 2 }], // 3ª fila
      ]),
    );
    const conTotal = semanas.filter((s) => s.totalM3 > 0);
    expect(conTotal.map((s) => s.totalM3)).toEqual([42.5, 20]);
  });

  it("no cuenta la producción de las celdas de relleno de otro mes", () => {
    // 31-jul-2026 aparece en la primera fila de agosto, pero no es del mes.
    const semanas = armarSemanas(2026, 8, new Map([["2026-07-31", { m3: 99, viajes: 9 }]]));
    expect(semanas[0].totalM3).toBe(0);
    expect(resumenMes(semanas).totalM3).toBe(0);
  });
});

describe("escala de color", () => {
  it("los cortes salen del rango real del mes, no de umbrales fijos", () => {
    const flojo = cortesEscala([10, 20, 30, 40, 50]);
    const fuerte = cortesEscala([100, 200, 300, 400, 500]);
    expect(flojo).toHaveLength(4);
    expect(fuerte[0]).toBeGreaterThan(flojo.at(-1)!);
    // Monótonos y crecientes (la escala nunca retrocede).
    for (let i = 1; i < flojo.length; i++) expect(flojo[i]).toBeGreaterThanOrEqual(flojo[i - 1]);
  });

  it("sin producción no hay nivel; el mayor volumen toma el nivel más oscuro", () => {
    const cortes = cortesEscala([10, 20, 30, 40, 50]);
    expect(nivelDeVolumen(0, cortes)).toBe(0);
    expect(nivelDeVolumen(10, cortes)).toBe(1);
    expect(nivelDeVolumen(50, cortes)).toBe(5);
  });

  it("un mes con un solo día de producción no revienta la escala", () => {
    const cortes = cortesEscala([0, 0, 120, 0]);
    expect(nivelDeVolumen(120, cortes)).toBeGreaterThanOrEqual(1);
    expect(nivelDeVolumen(0, cortes)).toBe(0);
  });
});

describe("resumenMes", () => {
  it("promedia sobre los días CON producción, no sobre los días del mes", () => {
    const semanas = armarSemanas(
      2026,
      8,
      new Map([
        ["2026-08-03", { m3: 100, viajes: 10 }],
        ["2026-08-04", { m3: 50, viajes: 5 }],
      ]),
    );
    const r = resumenMes(semanas);
    expect(r.totalM3).toBe(150);
    expect(r.diasConProduccion).toBe(2);
    expect(r.promedioPorDia).toBe(75); // 150/2, NO 150/31
    expect(r.maximo).toEqual({ iso: "2026-08-03", m3: 100 });
  });

  it("un mes sin producción devuelve ceros sin dividir por cero", () => {
    const r = resumenMes(armarSemanas(2026, 9, new Map()));
    expect(r).toMatchObject({ totalM3: 0, diasConProduccion: 0, promedioPorDia: 0, maximo: null });
  });
});

describe("navegación de mes", () => {
  it("cruza el año hacia atrás y hacia adelante", () => {
    expect(mesDesplazado(2026, 1, -1)).toBe("2025-12");
    expect(mesDesplazado(2026, 12, 1)).toBe("2027-01");
  });

  it("parsearMes cae al mes en curso si el parámetro viene mal", () => {
    expect(parsearMes("2026-03")).toEqual({ anio: 2026, mes: 3 });
    const hoy = new Date(2026, 7, 19);
    expect(parsearMes("basura", hoy)).toEqual({ anio: 2026, mes: 8 });
    expect(parsearMes("2026-13", hoy)).toEqual({ anio: 2026, mes: 8 });
    expect(parsearMes(undefined, hoy)).toEqual({ anio: 2026, mes: 8 });
  });
});

describe("ymdLocal", () => {
  it("usa la fecha LOCAL (no UTC, que correría el día en UTC-6)", () => {
    expect(ymdLocal(new Date(2026, 7, 1, 23, 30))).toBe("2026-08-01");
    expect(ymdLocal(new Date(2026, 7, 19, 0, 15))).toBe("2026-08-19");
  });
});
