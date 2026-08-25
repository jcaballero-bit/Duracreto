// Periodos de pago catorcenales (módulo PURO).
//
// Lo que importa aquí: que la catorcena sean 14 días EXACTOS, que el pago caiga 6 días
// después del cierre y que la navegación por índice no deje huecos ni traslapes entre
// un periodo y el siguiente (de ahí que se calculen desde un ancla en vez de leerlos).
import { describe, expect, it } from "vitest";
import {
  DIAS_PERIODO,
  diasDelPeriodo,
  etiquetaPeriodo,
  indicePorFecha,
  periodoPorIndice,
  periodoQueContiene,
} from "@/lib/planilla/periodos";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("periodos de pago", () => {
  it("el periodo ancla es 06-jul-2026 a 19-jul-2026 y se paga el 25-jul-2026", () => {
    const p = periodoPorIndice(0);
    expect(ymd(p.inicio)).toBe("2026-07-06");
    expect(ymd(p.fin)).toBe("2026-07-19");
    expect(ymd(p.pago)).toBe("2026-07-25");
  });

  it("son 14 días exactos, del inicio al fin inclusive", () => {
    const dias = diasDelPeriodo(periodoPorIndice(0));
    expect(dias).toHaveLength(DIAS_PERIODO);
    expect(ymd(dias[0])).toBe("2026-07-06");
    expect(ymd(dias[13])).toBe("2026-07-19");
  });

  it("el siguiente arranca justo al día después del cierre (sin hueco ni traslape)", () => {
    const p0 = periodoPorIndice(0);
    const p1 = periodoPorIndice(1);
    expect(ymd(p1.inicio)).toBe("2026-07-20");
    expect(ymd(p1.fin)).toBe("2026-08-02");
    expect(ymd(p1.pago)).toBe("2026-08-08");
    // Un día exacto entre el cierre de uno y el inicio del otro.
    expect(p1.inicio.getTime() - p0.fin.getTime()).toBe(86_400_000);
  });

  it("el pago siempre son 6 días después del cierre, en cualquier periodo", () => {
    for (const i of [-3, -1, 0, 1, 5, 26]) {
      const p = periodoPorIndice(i);
      expect((p.pago.getTime() - p.fin.getTime()) / 86_400_000).toBe(6);
      expect((p.fin.getTime() - p.inicio.getTime()) / 86_400_000).toBe(13);
    }
  });

  it("una fecha cae en su periodo, incluidos los bordes", () => {
    expect(indicePorFecha(new Date(2026, 6, 6))).toBe(0); // primer día
    expect(indicePorFecha(new Date(2026, 6, 19))).toBe(0); // último día
    expect(indicePorFecha(new Date(2026, 6, 20))).toBe(1); // primer día del siguiente
    expect(indicePorFecha(new Date(2026, 6, 5))).toBe(-1); // día anterior al ancla
    // Una hora del día no cambia el periodo.
    expect(indicePorFecha(new Date(2026, 6, 19, 23, 59))).toBe(0);
  });

  it("periodoQueContiene devuelve el periodo de una fecha cualquiera", () => {
    const p = periodoQueContiene(new Date(2026, 7, 25, 10, 30));
    expect(ymd(p.inicio)).toBe("2026-08-17");
    expect(ymd(p.fin)).toBe("2026-08-30");
    expect(p.indice).toBe(3);
  });

  it("la etiqueta se lee corrida y marca el año cuando el periodo lo cruza", () => {
    expect(etiquetaPeriodo(periodoPorIndice(0))).toBe("06 jul – 19 jul 2026");
    const cruzaAnio = periodoPorIndice(12); // 21-dic-2026 a 03-ene-2027
    expect(etiquetaPeriodo(cruzaAnio)).toBe("21 dic 2026 – 03 ene 2027");
  });
});
