import { describe, it, expect } from "vitest";
import {
  ventanaOcupada,
  ventanaDePedido,
  seTraslapan,
  MARGEN_LLEGADA_LABORATORISTA_MIN,
  type ViajeVentana,
} from "@/lib/laboratorio/ventana";

// Helper: viaje con solo los campos que interesan; el resto null.
function viaje(p: Partial<ViajeVentana>): ViajeVentana {
  return {
    mixer_id: 1,
    hora_llegada_proyecto: null,
    ts_llegada_real: null,
    hora_regreso_planta: null,
    ts_regreso_real: null,
    hora_fin_descarga: null,
    ts_fin_descarga_real: null,
    ...p,
  };
}

const D = (h: number, m = 0) => new Date(2026, 6, 29, h, m, 0, 0);

describe("ventanaOcupada", () => {
  it("toma la llegada más temprana (menos el margen) y la salida más tardía", () => {
    const v = ventanaOcupada([
      viaje({ hora_llegada_proyecto: D(9), hora_regreso_planta: D(11) }),
      viaje({ hora_llegada_proyecto: D(8), hora_regreso_planta: D(10) }),
    ]);
    expect(v).not.toBeNull();
    expect(v!.inicioMs).toBe(D(8).getTime() - MARGEN_LLEGADA_LABORATORISTA_MIN * 60_000);
    expect(v!.finMs).toBe(D(11).getTime());
  });

  it("prefiere los tiempos reales sobre los programados", () => {
    const v = ventanaOcupada([
      viaje({
        hora_llegada_proyecto: D(8),
        ts_llegada_real: D(8, 20),
        hora_regreso_planta: D(10),
        ts_regreso_real: D(10, 30),
      }),
    ]);
    expect(v!.inicioMs).toBe(D(8, 20).getTime() - MARGEN_LLEGADA_LABORATORISTA_MIN * 60_000);
    expect(v!.finMs).toBe(D(10, 30).getTime());
  });

  it("usa fin de descarga como respaldo cuando no hay regreso a planta", () => {
    const v = ventanaOcupada([
      viaje({ hora_llegada_proyecto: D(8), hora_fin_descarga: D(9, 30) }),
    ]);
    expect(v!.finMs).toBe(D(9, 30).getTime());
  });

  it("respeta un margen configurable", () => {
    const v = ventanaOcupada(
      [viaje({ hora_llegada_proyecto: D(8), hora_regreso_planta: D(10) })],
      30,
    );
    expect(v!.inicioMs).toBe(D(8).getTime() - 30 * 60_000);
  });

  it("devuelve null si no hay viajes con mixer o falta horario", () => {
    expect(ventanaOcupada([])).toBeNull();
    expect(ventanaOcupada([viaje({ mixer_id: null, hora_llegada_proyecto: D(8) })])).toBeNull();
    // llegada pero sin ninguna salida → no se puede cerrar la ventana
    expect(ventanaOcupada([viaje({ hora_llegada_proyecto: D(8) })])).toBeNull();
  });
});

describe("ventanaDePedido", () => {
  const diaRef = new Date(2026, 6, 29, 12, 0); // referencia: 29 jul
  it("descarta viajes cuya llegada cae en otro día (artefacto del motor)", () => {
    const v = ventanaDePedido(
      [
        viaje({ hora_llegada_proyecto: new Date(2026, 6, 28, 14, 4), hora_regreso_planta: new Date(2026, 6, 28, 14, 5) }),
        viaje({ hora_llegada_proyecto: D(9), hora_regreso_planta: D(10) }),
      ],
      diaRef,
    );
    // Solo cuenta el viaje del día 29 (9:00–10:00), no el del 28.
    expect(v!.inicioMs).toBe(D(9).getTime() - MARGEN_LLEGADA_LABORATORISTA_MIN * 60_000);
    expect(v!.finMs).toBe(D(10).getTime());
  });
  it("devuelve null si ningún viaje cae en el día del pedido", () => {
    expect(
      ventanaDePedido([viaje({ hora_llegada_proyecto: new Date(2026, 6, 28, 8), hora_regreso_planta: new Date(2026, 6, 28, 9) })], diaRef),
    ).toBeNull();
  });
});

describe("seTraslapan", () => {
  const A = { inicioMs: D(8).getTime(), finMs: D(10).getTime() };
  it("detecta traslape real", () => {
    expect(seTraslapan(A, { inicioMs: D(9).getTime(), finMs: D(11).getTime() })).toBe(true);
  });
  it("no marca traslape si son consecutivos (se tocan en el borde)", () => {
    expect(seTraslapan(A, { inicioMs: D(10).getTime(), finMs: D(12).getTime() })).toBe(false);
  });
  it("no marca traslape si están separados", () => {
    expect(seTraslapan(A, { inicioMs: D(11).getTime(), finMs: D(12).getTime() })).toBe(false);
  });
  it("detecta contención (una dentro de otra)", () => {
    expect(seTraslapan(A, { inicioMs: D(8, 30).getTime(), finMs: D(9, 30).getTime() })).toBe(true);
  });
});
