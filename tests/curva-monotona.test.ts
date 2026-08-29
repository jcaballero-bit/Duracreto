// Curva monótona del gráfico de tendencia (pura).
//
// La propiedad que se protege NO es estética: una curva libre puede dibujar entre dos
// meses un pico que nunca existió, o bajar de cero entre un 0 y un valor alto. En un
// gráfico de producción eso se lee como un dato real. Aquí se comprueba, muestreando la
// MISMA curva que se dibuja, que nunca sale del rango de los puntos que une.
import { describe, expect, it } from "vitest";
import { muestrearMonotona, rutaMonotona, tangentesMonotonas } from "@/lib/curva-monotona";

/** Puntos en coordenadas de DATO (x = índice del periodo, y = m³). */
const pts = (ys: number[]) => ys.map((y, x) => ({ x, y }));

/** Extremos de la curva muestreada. */
function rango(ys: number[], porTramo = 60) {
  const m = muestrearMonotona(pts(ys), porTramo).map((p) => p.y);
  return { min: Math.min(...m), max: Math.max(...m) };
}

describe("la curva pasa por los datos", () => {
  it("cada punto de dato está exactamente sobre la curva", () => {
    const ys = [10, 250, 30, 30, 0, 120];
    const muestras = muestrearMonotona(pts(ys), 20);
    ys.forEach((y, i) => {
      // El muestreo incluye el extremo de cada tramo, así que el punto exacto está ahí.
      const enX = muestras.filter((p) => Math.abs(p.x - i) < 1e-9);
      expect(enX.length, `falta el punto x=${i}`).toBeGreaterThan(0);
      for (const p of enX) expect(p.y).toBeCloseTo(y, 6);
    });
  });

  it("el path arranca en el primer punto y termina en el último", () => {
    const d = rutaMonotona(pts([5, 40, 12]));
    expect(d.startsWith("M0,5")).toBe(true);
    expect(d.endsWith("2,12")).toBe(true);
    // Y es una curva (C), no segmentos rectos (L).
    expect(d).toContain("C");
    expect(d).not.toContain("L");
  });

  it("con un solo punto no hay curva, y con ninguno la cadena es vacía", () => {
    expect(rutaMonotona(pts([7]))).toBe("M0,7");
    expect(rutaMonotona([])).toBe("");
  });
});

describe("NO sobrepasa los datos (la razón de usar monótona y no una Bézier libre)", () => {
  it("el caso real de agosto: de 6 m³ a 296 m³ no baja de 0 ni pasa de 296", () => {
    const ys = [6, 296];
    const { min, max } = rango(ys);
    expect(min).toBeGreaterThanOrEqual(6 - 1e-9);
    expect(max).toBeLessThanOrEqual(296 + 1e-9);
  });

  it("un 0 seguido de un valor alto no produce valores negativos", () => {
    // El caso de las semanas con poca actividad: 0, 0, 0, 296.
    for (const ys of [[0, 296], [0, 0, 296], [0, 0, 0, 296, 0], [0, 5, 0, 300, 0, 0]]) {
      const { min } = rango(ys);
      expect(min, `serie ${ys.join(",")}`).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("no inventa un pico entre dos valores parecidos", () => {
    // El ejemplo del requerimiento: 3800 y 4000 no pueden dar 4200 en medio.
    const { min, max } = rango([3500, 3800, 4000, 3900]);
    expect(max).toBeLessThanOrEqual(4000 + 1e-9);
    expect(min).toBeGreaterThanOrEqual(3500 - 1e-9);
  });

  it("en cada tramo la curva se queda entre sus dos extremos", () => {
    // La garantía fuerte: no solo global, sino tramo por tramo.
    const ys = [10, 250, 30, 31, 0, 120, 118, 400, 5];
    const p = pts(ys);
    for (let i = 0; i < ys.length - 1; i++) {
      const muestras = muestrearMonotona([p[i], p[i + 1]], 50).map((q) => q.y);
      const lo = Math.min(ys[i], ys[i + 1]);
      const hi = Math.max(ys[i], ys[i + 1]);
      expect(Math.min(...muestras), `tramo ${i}`).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(Math.max(...muestras), `tramo ${i}`).toBeLessThanOrEqual(hi + 1e-9);
    }
  });

  it("la curva COMPLETA tampoco se pasa de los datos, con series exigentes", () => {
    const series = [
      [0, 400, 0, 400, 0], // sierra
      [100, 100, 100], // plano
      [0, 1, 2, 3, 400], // rampa con salto
      [400, 5, 6, 5, 400], // valle profundo
      [63, 54, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // el año real del dev
    ];
    for (const ys of series) {
      const { min, max } = rango(ys);
      expect(min, `serie ${ys.join(",")}`).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-9);
      expect(max, `serie ${ys.join(",")}`).toBeLessThanOrEqual(Math.max(...ys) + 1e-9);
    }
  });

  it("en un máximo o mínimo local la tangente es 0 (no se pasa del pico)", () => {
    const m = tangentesMonotonas(pts([10, 250, 30]));
    expect(m[1]).toBe(0); // el 250 es un pico
    const v = tangentesMonotonas(pts([250, 10, 250]));
    expect(v[1]).toBe(0); // el 10 es un valle
  });

  it("un tramo plano se dibuja plano", () => {
    const ys = [100, 100, 100];
    const muestras = muestrearMonotona(pts(ys), 30).map((p) => p.y);
    for (const v of muestras) expect(v).toBeCloseTo(100, 9);
  });
});

describe("monotonía dentro de cada tramo", () => {
  it("si los datos suben, la curva sube en todo el tramo (no ondula)", () => {
    const muestras = muestrearMonotona(pts([0, 10, 50, 300]), 40);
    for (let i = 1; i < muestras.length; i++) {
      expect(muestras[i].y).toBeGreaterThanOrEqual(muestras[i - 1].y - 1e-9);
    }
  });

  it("si los datos bajan, la curva baja en todo el tramo", () => {
    const muestras = muestrearMonotona(pts([300, 50, 10, 0]), 40);
    for (let i = 1; i < muestras.length; i++) {
      expect(muestras[i].y).toBeLessThanOrEqual(muestras[i - 1].y + 1e-9);
    }
  });
});
