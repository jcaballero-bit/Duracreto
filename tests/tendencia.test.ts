// Periodos y series del gráfico de tendencia (puras, sin base de datos).
//
// Lo que se protege aquí es la diferencia entre los tres estados de un periodo, que es
// lo que hace útil una línea de tendencia:
//   · con producción  → su volumen
//   · sin producción  → CERO (la línea baja; en el calendario se deja vacío)
//   · futuro          → SIN DATO (la línea se corta; graficarlo como cero haría que toda
//                       tendencia terminara cayéndose a la nada)
import { describe, expect, it } from "vitest";
import {
  armarSeries,
  claveDe,
  cortesEjeY,
  esGranularidad,
  lunesDe,
  maximoVisible,
  periodosAnio,
  periodosMes,
  periodosSemanaDelMes,
  semanaIsoDe,
  leerPreferencia,
} from "@/lib/produccion/tendencia";

const AHORA = new Date(2026, 7, 27, 10, 0).getTime(); // jueves 27 de agosto de 2026

describe("semana ISO y lunes", () => {
  it("el lunes de un domingo es el lunes ANTERIOR (semana de lunes a domingo)", () => {
    // 2026-08-23 es domingo; su semana empezó el lunes 17.
    expect(lunesDe(new Date(2026, 7, 23)).getDate()).toBe(17);
    // Y el lunes de un lunes es él mismo.
    expect(lunesDe(new Date(2026, 7, 17)).getDate()).toBe(17);
  });

  it("la semana que cruza el 1 de enero pertenece al año de su jueves", () => {
    // 2026-01-01 es jueves → semana 1 de 2026.
    expect(semanaIsoDe(new Date(2026, 0, 1))).toEqual({ anio: 2026, semana: 1 });
    // 2025-12-29 es lunes de esa misma semana → también 2026-W01, no 2025-W53.
    expect(semanaIsoDe(new Date(2025, 11, 29))).toEqual({ anio: 2026, semana: 1 });
  });

  it("claveDe usa el año ISO en semana y el calendario en mes/año", () => {
    expect(claveDe(new Date(2025, 11, 29), "semana")).toBe("2026-W01");
    expect(claveDe(new Date(2025, 11, 29), "mes")).toBe("2025-12");
    expect(claveDe(new Date(2025, 11, 29), "anio")).toBe("2025");
  });
});

describe("periodos del eje", () => {
  it("semana: SOLO las semanas del mes, recortadas al mes", () => {
    // Agosto de 2026: el 1 es sábado y el 31 lunes, así que hay semanas parciales en
    // los dos extremos.
    const p = periodosSemanaDelMes(2026, 8, AHORA);
    // Ninguna semana empieza antes del 1 ni termina después del 31.
    const inicioMes = new Date(2026, 7, 1).getTime();
    const finMes = new Date(2026, 8, 1).getTime();
    for (const x of p) {
      expect(x.desdeMs).toBeGreaterThanOrEqual(inicioMes);
      expect(x.hastaMs).toBeLessThanOrEqual(finMes);
    }
    // Los tramos cubren el mes COMPLETO y sin traslaparse: la suma de sus duraciones
    // es exactamente el mes (es lo que hace que la suma de las semanas sea el total).
    expect(p[0].desdeMs).toBe(inicioMes);
    expect(p[p.length - 1].hastaMs).toBe(finMes);
    for (let i = 1; i < p.length; i++) expect(p[i].desdeMs).toBe(p[i - 1].hastaMs);
    expect(p.reduce((s, x) => s + (x.hastaMs - x.desdeMs), 0)).toBe(finMes - inicioMes);
  });

  it("semana: la primera y la última semana de agosto de 2026 son PARCIALES", () => {
    const p = periodosSemanaDelMes(2026, 8, AHORA);
    // 1 y 2 de agosto (sábado y domingo) cierran la semana que empezó el 27 de julio.
    expect(p[0].hastaMs - p[0].desdeMs).toBe(2 * 86400000);
    expect(p[0].etiquetaLarga).toContain("otro mes");
    // El 31 (lunes) abre una semana que sigue en septiembre.
    const ult = p[p.length - 1];
    expect(ult.hastaMs - ult.desdeMs).toBe(1 * 86400000);
    expect(ult.etiquetaLarga).toContain("otro mes");
    // Las de en medio son completas y no llevan el aviso.
    expect(p[1].hastaMs - p[1].desdeMs).toBe(7 * 86400000);
    expect(p[1].etiquetaLarga).not.toContain("otro mes");
  });

  it("semana: un mes que empieza en lunes no tiene semana parcial al inicio", () => {
    // Junio de 2026 empieza en lunes.
    const p = periodosSemanaDelMes(2026, 6, AHORA);
    expect(p[0].hastaMs - p[0].desdeMs).toBe(7 * 86400000);
    expect(p[0].etiquetaLarga).not.toContain("otro mes");
  });

  it("semana: los meses futuros del mismo año van sin dato", () => {
    // Diciembre de 2026 no ha empezado.
    expect(periodosSemanaDelMes(2026, 12, AHORA).every((x) => x.futuro)).toBe(true);
    // Y en el mes en curso, la semana que ya empezó no es futuro.
    const ago = periodosSemanaDelMes(2026, 8, AHORA);
    expect(ago[0].futuro).toBe(false);
  });

  it("mes: los 12 meses del año, y los que aún no empiezan son FUTURO", () => {
    const p = periodosMes(2026, AHORA);
    expect(p).toHaveLength(12);
    expect(p.map((x) => x.clave)[0]).toBe("2026-01");
    // Agosto está en curso: es dato real (parcial), no futuro.
    expect(p[7].futuro).toBe(false);
    // Septiembre en adelante no ha empezado.
    expect(p.slice(8).every((x) => x.futuro)).toBe(true);
    expect(p.slice(0, 8).some((x) => x.futuro)).toBe(false);
  });

  it("año: un punto por año, inclusive en los dos extremos", () => {
    const p = periodosAnio(2024, 2026, AHORA);
    expect(p.map((x) => x.clave)).toEqual(["2024", "2025", "2026"]);
    expect(p.every((x) => !x.futuro)).toBe(true);
    // Un año que todavía no empieza sí es futuro.
    expect(periodosAnio(2026, 2027, AHORA)[1].futuro).toBe(true);
  });

  it("la clave del periodo coincide con la que calcula claveDe para su fecha", () => {
    // Es el contrato entre el eje y la consulta: si se desincronizan, el gráfico sale en
    // cero aunque la base tenga los datos.
    for (const p of periodosSemanaDelMes(2026, 8, AHORA)) {
      expect(claveDe(new Date(p.desdeMs), "semana")).toBe(p.clave);
    }
    for (const p of periodosMes(2026, AHORA)) {
      expect(claveDe(new Date(p.desdeMs), "mes")).toBe(p.clave);
    }
    for (const p of periodosAnio(2024, 2026, AHORA)) {
      expect(claveDe(new Date(p.desdeMs), "anio")).toBe(p.clave);
    }
  });
});

describe("armarSeries", () => {
  const periodos = periodosMes(2026, AHORA);
  const nombre = (id: number) => `Plantel ${id}`;
  const color = (id: number) => `#00000${id}`;
  // Julio: 100 en el plantel 1 y 40 en el 2. Agosto: solo 60 en el 1.
  const datos = new Map<string, Map<number, number>>([
    ["2026-07", new Map([[1, 100], [2, 40]])],
    ["2026-08", new Map([[1, 60]])],
  ]);

  it("TOTAL = una sola línea con la suma de todos los planteles", () => {
    const s = armarSeries(periodos, datos, null, nombre, color, "Total nacional", "#111");
    expect(s).toHaveLength(1);
    expect(s[0].nombre).toBe("Total nacional");
    expect(s[0].valores[6]).toBe(140); // julio = 100 + 40
    expect(s[0].valores[7]).toBe(60); // agosto = 60
  });

  it("un solo plantel = una sola línea, solo la de ese plantel", () => {
    const s = armarSeries(periodos, datos, [2], nombre, color, "Total", "#111");
    expect(s).toHaveLength(1);
    expect(s[0].plantelId).toBe(2);
    expect(s[0].valores[6]).toBe(40);
    // Agosto no tiene volumen de ese plantel: es CERO, no un hueco.
    expect(s[0].valores[7]).toBe(0);
  });

  it("varios planteles = una línea por plantel, cada una con su color", () => {
    const s = armarSeries(periodos, datos, [1, 2], nombre, color, "Total", "#111");
    expect(s).toHaveLength(2);
    expect(s.map((x) => x.plantelId)).toEqual([1, 2]);
    expect(s[0].color).toBe("#000001");
    expect(s[1].color).toBe("#000002");
    // Y la suma de las dos líneas en julio da el total.
    expect((s[0].valores[6] ?? 0) + (s[1].valores[6] ?? 0)).toBe(140);
  });

  it("un periodo sin producción vale CERO y un periodo futuro queda SIN DATO", () => {
    const s = armarSeries(periodos, datos, null, nombre, color, "Total", "#111");
    expect(s[0].valores[0]).toBe(0); // enero: no se produjo
    expect(s[0].valores[8]).toBeNull(); // septiembre: todavía no ocurre
    expect(s[0].valores.slice(8).every((v) => v === null)).toBe(true);
  });

  it("cambiar la granularidad no altera los totales", () => {
    // Mismo volumen agrupado por mes y por año: el año debe ser la suma de los meses.
    const porMes = armarSeries(periodos, datos, null, nombre, color, "T", "#111");
    const sumaMeses = porMes[0].valores.reduce<number>((a, v) => a + (v ?? 0), 0);
    const porAnio = armarSeries(
      periodosAnio(2026, 2026, AHORA),
      new Map([["2026", new Map([[1, 160], [2, 40]])]]),
      null,
      nombre,
      color,
      "T",
      "#111",
    );
    expect(porAnio[0].valores[0]).toBe(sumaMeses);
  });
});

describe("escala del eje vertical", () => {
  it("se ajusta al máximo visible, no a un techo fijo", () => {
    const serie = (vals: (number | null)[]) => [
      { plantelId: 1, nombre: "x", color: "#000", valores: vals },
    ];
    expect(maximoVisible(serie([10, 250, 30]))).toBe(250);
    // Sin datos no divide por cero.
    expect(maximoVisible(serie([null, null]))).toBe(1);
    expect(maximoVisible([])).toBe(1);
  });

  it("los cortes son números redondos y el techo cubre el máximo", () => {
    const c = cortesEjeY(137.4);
    expect(c[0]).toBe(0);
    expect(c[c.length - 1]).toBeGreaterThanOrEqual(137.4);
    // Paso uniforme y "redondo".
    const paso = c[1] - c[0];
    for (let i = 1; i < c.length; i++) expect(Math.abs(c[i] - c[i - 1] - paso)).toBeLessThan(0.01);
    expect([1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500]).toContain(paso);
  });
});

describe("preferencia guardada (viene del navegador: se valida)", () => {
  it("por defecto abre en Mes con el total", () => {
    expect(leerPreferencia(undefined)).toEqual({ g: "mes", sel: null });
    expect(leerPreferencia("")).toEqual({ g: "mes", sel: null });
  });

  it("lee una preferencia válida", () => {
    expect(leerPreferencia('{"g":"semana","sel":[1,3]}')).toEqual({ g: "semana", sel: [1, 3] });
  });

  it("basura, tipos raros o valores inventados caen al valor por defecto", () => {
    expect(leerPreferencia("no-json")).toEqual({ g: "mes", sel: null });
    expect(leerPreferencia('{"g":"decada","sel":"todos"}')).toEqual({ g: "mes", sel: null });
    expect(leerPreferencia('{"g":"anio","sel":[1,"x"]}')).toEqual({ g: "anio", sel: null });
    expect(leerPreferencia('{"g":"mes","sel":[]}')).toEqual({ g: "mes", sel: null });
    expect(leerPreferencia("null")).toEqual({ g: "mes", sel: null });
  });

  it("esGranularidad solo acepta los tres valores", () => {
    expect(["semana", "mes", "anio"].every(esGranularidad)).toBe(true);
    expect(esGranularidad("dia")).toBe(false);
    expect(esGranularidad(undefined)).toBe(false);
  });
});
