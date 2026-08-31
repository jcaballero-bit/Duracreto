// Reglas de la producción histórica (puras).
//
// Las dos que sostienen la confianza en los números:
//   1. El SISTEMA siempre gana, y las dos fuentes NUNCA se suman. Sumarlas duplicaría el
//      volumen, que es el error que este módulo existe para impedir.
//   2. Un total MENSUAL no se reparte entre días: alimenta solo Mes y Año.
import { describe, expect, it } from "vitest";
import {
  chocaConSistema,
  combinarDiario,
  combinarPorPeriodo,
  conflictoDeAlcance,
  esGranularidadHistorica,
  normalizarAlias,
  ym,
  ymd,
  type FilaHistorica,
  type PeriodoRango,
} from "@/lib/produccion/historica";

const dia = (a: number, m: number, d: number) => new Date(a, m - 1, d).getTime();
const fila = (
  a: number,
  m: number,
  d: number,
  plantelId: number,
  m3: number,
  granularidad: FilaHistorica["granularidad"] = "Diaria",
): FilaHistorica => ({ fechaMs: dia(a, m, d), plantelId, m3, granularidad });

describe("combinarDiario: el sistema gana y nunca se suman", () => {
  it("un día sin datos del sistema toma el valor histórico", () => {
    const { combinado, origenHistorico } = combinarDiario(new Map(), [fila(2025, 7, 3, 1, 40)]);
    expect(combinado.get("2025-07-03")?.get(1)).toBe(40);
    expect(origenHistorico.get("2025-07-03")?.has(1)).toBe(true);
  });

  it("si el sistema tiene ese día y plantel, el histórico NO se usa ni se suma", () => {
    const sistema = new Map([["2025-07-03", new Map([[1, 30]])]]);
    const { combinado, origenHistorico } = combinarDiario(sistema, [fila(2025, 7, 3, 1, 40)]);
    // 30, no 70 y no 40.
    expect(combinado.get("2025-07-03")?.get(1)).toBe(30);
    expect(origenHistorico.has("2025-07-03")).toBe(false);
  });

  it("la precedencia es por día Y plantel: un plantel no tapa al otro", () => {
    const sistema = new Map([["2025-07-03", new Map([[1, 30]])]]);
    const { combinado } = combinarDiario(sistema, [
      fila(2025, 7, 3, 1, 40), // el sistema ya lo tiene: se ignora
      fila(2025, 7, 3, 2, 12), // este plantel no: entra
    ]);
    expect(combinado.get("2025-07-03")?.get(1)).toBe(30);
    expect(combinado.get("2025-07-03")?.get(2)).toBe(12);
  });

  it("una fila MENSUAL nunca entra al diario", () => {
    const { combinado } = combinarDiario(new Map(), [fila(2025, 7, 1, 1, 900, "Mensual")]);
    expect(combinado.size).toBe(0);
  });

  it("no muta el mapa del sistema que recibe", () => {
    const sistema = new Map([["2025-07-03", new Map([[1, 30]])]]);
    combinarDiario(sistema, [fila(2025, 7, 4, 1, 40)]);
    expect(sistema.size).toBe(1);
    expect(sistema.has("2025-07-04")).toBe(false);
  });

  it("sin filas históricas devuelve exactamente lo del sistema", () => {
    const sistema = new Map([["2025-07-03", new Map([[1, 30]])]]);
    const { combinado, origenHistorico } = combinarDiario(sistema, []);
    expect([...combinado.get("2025-07-03")!.entries()]).toEqual([[1, 30]]);
    expect(origenHistorico.size).toBe(0);
  });
});

describe("combinarPorPeriodo: las reglas en el gráfico", () => {
  const meses: PeriodoRango[] = [
    { clave: "2025-06", desdeMs: dia(2025, 6, 1), hastaMs: dia(2025, 7, 1) },
    { clave: "2025-07", desdeMs: dia(2025, 7, 1), hastaMs: dia(2025, 8, 1) },
    { clave: "2025-08", desdeMs: dia(2025, 8, 1), hastaMs: dia(2025, 9, 1) },
  ];
  const vacio = { permiteMensual: true, mesesConSistema: new Map(), diasConSistema: new Map() };

  it("una carga MENSUAL aparece en la vista de Mes", () => {
    const { combinado, periodosHistoricos } = combinarPorPeriodo(
      meses,
      new Map(),
      [fila(2025, 7, 1, 1, 900, "Mensual")],
      vacio,
    );
    expect(combinado.get("2025-07")?.get(1)).toBe(900);
    expect(periodosHistoricos.has("2025-07")).toBe(true);
  });

  it("una carga MENSUAL NO aparece cuando la vista es de Semana", () => {
    const { combinado } = combinarPorPeriodo(meses, new Map(), [fila(2025, 7, 1, 1, 900, "Mensual")], {
      ...vacio,
      permiteMensual: false,
    });
    expect(combinado.size).toBe(0);
  });

  it("las cargas DIARIAS se suman a su periodo", () => {
    const { combinado } = combinarPorPeriodo(
      meses,
      new Map(),
      [fila(2025, 7, 3, 1, 40), fila(2025, 7, 20, 1, 60), fila(2025, 8, 2, 1, 10)],
      vacio,
    );
    expect(combinado.get("2025-07")?.get(1)).toBe(100);
    expect(combinado.get("2025-08")?.get(1)).toBe(10);
  });

  it("si el sistema tiene ALGO en el mes, la carga MENSUAL no entra", () => {
    // Sumar el total del mes cuando el sistema ya cubre algunos días duplicaría esos días.
    const { combinado } = combinarPorPeriodo(meses, new Map([["2025-07", new Map([[1, 300]])]]), [
      fila(2025, 7, 1, 1, 900, "Mensual"),
    ], {
      ...vacio,
      mesesConSistema: new Map([["2025-07", new Set([1])]]),
    });
    expect(combinado.get("2025-07")?.get(1)).toBe(300);
  });

  it("la carga DIARIA se descarta día por día, no mes por mes", () => {
    // El sistema cubre el 3; el 20 no. Entra solo el 20.
    const { combinado } = combinarPorPeriodo(meses, new Map([["2025-07", new Map([[1, 30]])]]), [
      fila(2025, 7, 3, 1, 40),
      fila(2025, 7, 20, 1, 60),
    ], {
      ...vacio,
      diasConSistema: new Map([["2025-07-03", new Set([1])]]),
    });
    expect(combinado.get("2025-07")?.get(1)).toBe(90); // 30 del sistema + 60 del 20
  });

  it("sin filas históricas devuelve exactamente lo del sistema", () => {
    const sistema = new Map([["2025-07", new Map([[1, 300]])]]);
    const { combinado, periodosHistoricos } = combinarPorPeriodo(meses, sistema, [], vacio);
    expect(combinado.get("2025-07")?.get(1)).toBe(300);
    expect(periodosHistoricos.size).toBe(0);
  });

  it("una fila fuera del eje no se cuela en ningún periodo", () => {
    const { combinado } = combinarPorPeriodo(meses, new Map(), [fila(2024, 1, 5, 1, 50)], vacio);
    expect(combinado.size).toBe(0);
  });
});

describe("aviso de choque antes de guardar", () => {
  const dias = new Map([["2025-07-03", new Set([1])]]);
  const meses = new Map([["2025-07", new Set([1])]]);

  it("una carga DIARIA choca si el sistema tiene ese día", () => {
    expect(chocaConSistema({ fechaMs: dia(2025, 7, 3), plantelId: 1, granularidad: "Diaria" }, dias, meses)).toBe(true);
    expect(chocaConSistema({ fechaMs: dia(2025, 7, 4), plantelId: 1, granularidad: "Diaria" }, dias, meses)).toBe(false);
    // Otro plantel el mismo día no choca.
    expect(chocaConSistema({ fechaMs: dia(2025, 7, 3), plantelId: 2, granularidad: "Diaria" }, dias, meses)).toBe(false);
  });

  it("una carga MENSUAL choca si el sistema tiene CUALQUIER día del mes", () => {
    expect(chocaConSistema({ fechaMs: dia(2025, 7, 1), plantelId: 1, granularidad: "Mensual" }, dias, meses)).toBe(true);
    expect(chocaConSistema({ fechaMs: dia(2025, 6, 1), plantelId: 1, granularidad: "Mensual" }, dias, meses)).toBe(false);
  });
});

describe("helpers", () => {
  it("ymd y ym usan la hora local", () => {
    expect(ymd(new Date(2025, 6, 3))).toBe("2025-07-03");
    expect(ym(new Date(2025, 6, 3))).toBe("2025-07");
  });

  it("normalizarAlias ignora acentos, mayúsculas y espacios de más", () => {
    // Es lo que hace que "PUERTO CORTÉS" del Excel encuentre "Puerto Cortés".
    expect(normalizarAlias("  PUERTO  CORTÉS ")).toBe("puerto cortes");
    expect(normalizarAlias("S. Marta")).toBe("s. marta");
  });

  it("esGranularidadHistorica solo acepta los dos valores", () => {
    expect(esGranularidadHistorica("Diaria")).toBe(true);
    expect(esGranularidadHistorica("Mensual")).toBe(true);
    expect(esGranularidadHistorica("Semanal")).toBe(false);
    expect(esGranularidadHistorica(undefined)).toBe(false);
  });
});

describe("por PLANTEL o por PLANTA, nunca los dos (regla 3)", () => {
  // Cargar el total del plantel Y el de sus plantas para la misma fecha contaria el
  // mismo volumen dos veces: el total del plantel YA incluye a sus plantas.
  it("deja cargar una planta cuando no hay nada mas", () => {
    expect(conflictoDeAlcance(7, [])).toBeNull();
  });

  it("deja cargar VARIAS plantas del mismo plantel: se suman entre si", () => {
    expect(conflictoDeAlcance(8, [7])).toBeNull();
    expect(conflictoDeAlcance(9, [7, 8])).toBeNull();
  });

  it("deja cargar el total del plantel cuando no hay detalle por planta", () => {
    expect(conflictoDeAlcance(null, [])).toBeNull();
  });

  it("RECHAZA el total del plantel si ya hay detalle por planta", () => {
    const motivo = conflictoDeAlcance(null, [7, 8]);
    expect(motivo).toMatch(/por PLANTA/);
    expect(motivo).toMatch(/dos veces/);
  });

  it("RECHAZA una planta si ya hay total del plantel", () => {
    const motivo = conflictoDeAlcance(7, [null]);
    expect(motivo).toMatch(/PLANTEL completo/);
    expect(motivo).toMatch(/dos veces/);
  });

  it("actualizar la MISMA fila no es un conflicto consigo misma", () => {
    // El llamador excluye la fila que se esta actualizando antes de preguntar; aqui se
    // documenta que con esa exclusion el resultado es limpio en los dos alcances.
    expect(conflictoDeAlcance(7, [8])).toBeNull(); // ya existia la 7, se excluyo
    expect(conflictoDeAlcance(null, [])).toBeNull(); // ya existia la del plantel
  });
});
