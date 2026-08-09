import { describe, expect, it } from "vitest";
import { analizarFrecuencia, desglosarCiclo, type EntradaFrecuencia } from "@/lib/motor/frecuencia";

// Caso base tipo Santa Marta: mixers de 11 m³, planta de 45 m³/h, alistamiento 5,
// ida/regreso 30, descarga directa (1.5 min/m³).
//   carga    = 5 + 11*60/45      = 5 + 14.6667 = 19.6667
//   salida   = 0
//   ida      = 30
//   descarga = 11 * 1.5          = 16.5
//   regreso  = 30
//   ciclo    = 96.1667 min
const BASE: EntradaFrecuencia = {
  volumenPorViaje: 11,
  capacidadPlantaM3h: 45,
  alistamientoMin: 5,
  tiempoIdaMin: 30,
  tiempoRegresoMin: 30,
  tipoDescarga: "Canal directo",
  mixersDisponibles: 6,
  numeroBahias: 1,
  frecuenciaSolicitadaMin: 15,
};

describe("desglosarCiclo", () => {
  it("suma alistamiento + carga + salida + ida + descarga + regreso", () => {
    const c = desglosarCiclo(BASE);
    expect(c.cargaMin).toBeCloseTo(19.6667, 3);
    expect(c.salidaMin).toBe(0);
    expect(c.idaMin).toBe(30);
    expect(c.descargaMin).toBeCloseTo(16.5, 3);
    expect(c.regresoMin).toBe(30);
    expect(c.cicloMin).toBeCloseTo(96.1667, 3);
  });
});

describe("analizarFrecuencia", () => {
  it("caso real Santa Marta: 12 mixers en 2 plantas → freq 15 SÍ alcanzable", () => {
    // 6x11 + 6x9 = 12 mixers, 2 bahías (STALO + SANY).
    const r = analizarFrecuencia({ ...BASE, mixersDisponibles: 12, numeroBahias: 2 });
    // mixers: 96.17/12 = 8.01 ; bahías: 19.67/2 = 9.83 → manda bahías → ceil 10 ≤ 15.
    expect(r.frecuenciaAlcanzableMin).toBe(10);
    expect(r.alcanzable).toBe(true);
    expect(r.limitadoPor).toBe("ok");
    // Para sostener 15 min bastan ceil(96.17/15) = 7 mixers.
    expect(r.mixersMinimos).toBe(7);
  });

  it("flota escasa: 3 mixers en 2 plantas → freq 15 NO alcanzable, limita la FLOTA", () => {
    const r = analizarFrecuencia({ ...BASE, mixersDisponibles: 3, numeroBahias: 2 });
    // mixers: 96.17/3 = 32.06 (manda) ; bahías: 9.83 → ceil 33.
    expect(r.frecuenciaAlcanzableMin).toBe(33);
    expect(r.alcanzable).toBe(false);
    expect(r.limitadoPor).toBe("mixers");
    expect(r.mixersMinimos).toBe(7);
  });

  it("una sola bahía: aunque sobren mixers, la CARGA en planta es el cuello de botella", () => {
    // 20 mixers pero 1 sola planta: no se puede cargar uno más seguido que ~20 min.
    const r = analizarFrecuencia({ ...BASE, mixersDisponibles: 20, numeroBahias: 1 });
    // bahías: 19.67/1 = 19.67 (manda sobre mixers 96.17/20=4.8) → ceil 20 > 15 pedidos.
    expect(r.frecuenciaAlcanzableMin).toBe(20);
    expect(r.alcanzable).toBe(false);
    expect(r.limitadoPor).toBe("bahias");
  });

  it("sin mixers disponibles → frecuencia no alcanzable (infinita)", () => {
    const r = analizarFrecuencia({ ...BASE, mixersDisponibles: 0 });
    expect(r.frecuenciaAlcanzableMin).toBe(Infinity);
    expect(r.alcanzable).toBe(false);
  });

  it("frecuencia holgada siempre alcanzable con flota razonable", () => {
    const r = analizarFrecuencia({
      ...BASE,
      mixersDisponibles: 6,
      numeroBahias: 1,
      frecuenciaSolicitadaMin: 30,
    });
    expect(r.alcanzable).toBe(true);
    expect(r.limitadoPor).toBe("ok");
  });
});
