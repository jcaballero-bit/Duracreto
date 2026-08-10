import { describe, expect, it } from "vitest";
import {
  capacidadExcedida,
  detectarTraslapesCarga,
  detectarTraslapesMixer,
  frecuenciaRealPorCliente,
  idsEnTraslape,
  idsEnTraslapeCarga,
  margenApretado,
  type ViajeManual,
} from "@/lib/motor/validacion-manual";

const MIN = 60_000;
// Constructor de viaje manual con solo los campos relevantes para cada prueba.
function v(p: Partial<ViajeManual> & { id: ViajeManual["id"] }): ViajeManual {
  return {
    plantaId: 1,
    clienteId: 1,
    mixerId: null,
    volumen: 0,
    inicioCargaMs: 0,
    finCargaMs: 0,
    llegadaMs: 0,
    regresoMs: 0,
    ...p,
  };
}

describe("detectarTraslapesMixer", () => {
  it("marca dos viajes del MISMO mixer cuyos ciclos se enciman", () => {
    const viajes = [
      v({ id: "a", mixerId: 1, inicioCargaMs: 0, regresoMs: 100 * MIN }),
      v({ id: "b", mixerId: 1, inicioCargaMs: 50 * MIN, regresoMs: 150 * MIN }), // traslapa con a
      v({ id: "c", mixerId: 2, inicioCargaMs: 0, regresoMs: 100 * MIN }), // otro mixer, no cuenta
    ];
    const conf = detectarTraslapesMixer(viajes);
    expect(conf.length).toBe(1);
    expect(conf[0].mixerId).toBe(1);
    const ids = idsEnTraslape(conf);
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(true);
    expect(ids.has("c")).toBe(false);
  });

  it("bordes que se tocan NO cuentan como traslape", () => {
    const viajes = [
      v({ id: "a", mixerId: 1, inicioCargaMs: 0, regresoMs: 100 * MIN }),
      v({ id: "b", mixerId: 1, inicioCargaMs: 100 * MIN, regresoMs: 200 * MIN }), // toca el borde
    ];
    expect(detectarTraslapesMixer(viajes).length).toBe(0);
  });

  it("viajes sin mixer no generan traslape", () => {
    const viajes = [
      v({ id: "a", mixerId: null, inicioCargaMs: 0, regresoMs: 100 * MIN }),
      v({ id: "b", mixerId: null, inicioCargaMs: 10 * MIN, regresoMs: 90 * MIN }),
    ];
    expect(detectarTraslapesMixer(viajes).length).toBe(0);
  });
});

describe("detectarTraslapesCarga (boca de carga de la planta)", () => {
  it("marca 2 viajes de la MISMA planta cuyas ventanas de carga se encimen", () => {
    // Planta 1: uno carga 07:41–08:01 (20 min), otro arranca 07:50 → encima 11 min.
    const c0741 = new Date("2026-08-10T07:41:00").getTime();
    const c0801 = new Date("2026-08-10T08:01:00").getTime();
    const c0750 = new Date("2026-08-10T07:50:00").getTime();
    const c0810 = new Date("2026-08-10T08:10:00").getTime();
    const viajes = [
      v({ id: "a", plantaId: 1, inicioCargaMs: c0741, finCargaMs: c0801 }),
      v({ id: "b", plantaId: 1, inicioCargaMs: c0750, finCargaMs: c0810 }),
    ];
    const conf = detectarTraslapesCarga(viajes);
    expect(conf.length).toBe(1);
    expect(conf[0].solapeMin).toBe(11); // 08:01 - 07:50 = 11 min
    const ids = idsEnTraslapeCarga(conf);
    expect(ids.has("a") && ids.has("b")).toBe(true);
  });

  it("cargas consecutivas que NO se enciman en la misma planta no avisan", () => {
    const c0700 = new Date("2026-08-10T07:00:00").getTime();
    const c0720 = new Date("2026-08-10T07:20:00").getTime();
    const c0730 = new Date("2026-08-10T07:30:00").getTime();
    const c0750 = new Date("2026-08-10T07:50:00").getTime();
    const viajes = [
      v({ id: "a", plantaId: 1, inicioCargaMs: c0700, finCargaMs: c0720 }),
      v({ id: "b", plantaId: 1, inicioCargaMs: c0730, finCargaMs: c0750 }),
    ];
    expect(detectarTraslapesCarga(viajes).length).toBe(0);
  });

  it("cargas simultáneas pero en PLANTAS distintas no chocan (carga simultánea válida)", () => {
    const c0700 = new Date("2026-08-10T07:00:00").getTime();
    const c0720 = new Date("2026-08-10T07:20:00").getTime();
    const viajes = [
      v({ id: "a", plantaId: 1, inicioCargaMs: c0700, finCargaMs: c0720 }),
      v({ id: "b", plantaId: 2, inicioCargaMs: c0700, finCargaMs: c0720 }),
    ];
    expect(detectarTraslapesCarga(viajes).length).toBe(0);
  });
});

describe("capacidadExcedida", () => {
  it("avisa si en una ventana de 60 min el volumen supera la capacidad de la planta", () => {
    // 3 cargas de 20 m³ en la misma hora = 60 m³ > 45 m³/h.
    const viajes = [
      v({ id: 1, plantaId: 1, volumen: 20, inicioCargaMs: 0 }),
      v({ id: 2, plantaId: 1, volumen: 20, inicioCargaMs: 15 * MIN }),
      v({ id: 3, plantaId: 1, volumen: 20, inicioCargaMs: 30 * MIN }),
    ];
    const avisos = capacidadExcedida(viajes, 45);
    expect(avisos.length).toBeGreaterThan(0);
    expect(avisos[0].volumenEnVentana).toBe(60);
  });

  it("no avisa si la carga cabe en la capacidad", () => {
    const viajes = [
      v({ id: 1, plantaId: 1, volumen: 10, inicioCargaMs: 0 }),
      v({ id: 2, plantaId: 1, volumen: 10, inicioCargaMs: 30 * MIN }),
    ];
    expect(capacidadExcedida(viajes, 45).length).toBe(0);
  });
});

describe("margenApretado", () => {
  it("avisa si el siguiente viaje del mixer arranca antes del margen mínimo tras el regreso", () => {
    const viajes = [
      v({ id: "a", mixerId: 1, inicioCargaMs: 0, regresoMs: 60 * MIN }),
      v({ id: "b", mixerId: 1, inicioCargaMs: 65 * MIN, regresoMs: 120 * MIN }), // solo 5 min de margen
    ];
    const avisos = margenApretado(viajes, 10);
    expect(avisos.length).toBe(1);
    expect(avisos[0].margenMin).toBe(5);
  });

  it("no avisa si el margen es suficiente", () => {
    const viajes = [
      v({ id: "a", mixerId: 1, inicioCargaMs: 0, regresoMs: 60 * MIN }),
      v({ id: "b", mixerId: 1, inicioCargaMs: 80 * MIN, regresoMs: 120 * MIN }), // 20 min de margen
    ];
    expect(margenApretado(viajes, 10).length).toBe(0);
  });
});

describe("frecuenciaRealPorCliente", () => {
  it("calcula la mediana del hueco entre llegadas por cliente", () => {
    const viajes = [
      v({ id: 1, clienteId: 7, llegadaMs: 0 }),
      v({ id: 2, clienteId: 7, llegadaMs: 15 * MIN }),
      v({ id: 3, clienteId: 7, llegadaMs: 30 * MIN }),
    ];
    const freq = frecuenciaRealPorCliente(viajes);
    expect(freq.get(7)).toBe(15);
  });

  it("null si el cliente tiene menos de 2 llegadas", () => {
    const freq = frecuenciaRealPorCliente([v({ id: 1, clienteId: 9, llegadaMs: 0 })]);
    expect(freq.get(9)).toBeNull();
  });
});
