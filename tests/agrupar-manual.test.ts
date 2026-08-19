// Orden y agrupación de los bloques de cliente en el Modo Manual (pruebas puras).
import { describe, expect, it } from "vitest";
import { agruparFilasPorPedido, type FilaAgrupable } from "@/lib/programacion/agrupar-manual";

interface Fila extends FilaAgrupable {
  cargaMs: number;
  volumen: number;
  /** Llegada a obra del mixer: con ella se ordenan los bloques de cliente. */
  llegadaMs: number;
}
const f = (
  id: number,
  pedidoId: number,
  ordenDia: number | null,
  cargaMs: number,
  volumen = 9,
  // Por defecto la llegada va 30 min después de la carga (un ciclo típico).
  llegadaMs = cargaMs + 30,
): Fila => ({
  id,
  pedidoId,
  ordenDia,
  clienteId: pedidoId,
  empresa: `Cliente ${pedidoId}`,
  proyecto: "",
  cargaMs,
  volumen,
  llegadaMs,
});
const agrupar = (filas: Fila[]) =>
  agruparFilasPorPedido(
    filas,
    (x) => x.cargaMs,
    (x) => x.volumen,
    (x) => x.llegadaMs,
  );

describe("agruparFilasPorPedido", () => {
  it("junta los viajes de un cliente aunque vengan intercalados", () => {
    const g = agrupar([f(1, 10, 1, 700), f(2, 20, 2, 730), f(3, 10, 1, 800)]);
    expect(g.map((x) => x.pedidoId)).toEqual([10, 20]);
    expect(g[0].filas.map((x) => x.id)).toEqual([1, 3]);
    expect(g[1].filas.map((x) => x.id)).toEqual([2]);
  });

  it("ordena los bloques por la LLEGADA del primer mixer, no por orden_dia", () => {
    // El pedido 20 tiene orden 2 pero su mixer llega ANTES: va primero.
    const g = agrupar([f(1, 10, 1, 900), f(2, 20, 2, 700)]);
    expect(g.map((x) => x.pedidoId)).toEqual([20, 10]);
  });

  it("toma la llegada MÁS TEMPRANA del cliente, no la de su primer viaje en la lista", () => {
    // El viaje 2 del cliente 10 llega antes que el 1 (se editó la hora a mano).
    const g = agrupar([f(1, 10, 1, 900, 9, 1000), f(2, 10, 1, 950, 9, 600), f(3, 20, 2, 700, 9, 800)]);
    expect(g.map((x) => x.pedidoId)).toEqual([10, 20]);
  });

  it("orden_dia solo desempata cuando dos clientes llegan a la misma hora", () => {
    const g = agrupar([f(1, 30, 9, 700, 9, 800), f(2, 40, 2, 705, 9, 800)]);
    expect(g.map((x) => x.pedidoId)).toEqual([40, 30]);
  });

  it("dentro del bloque los viajes van por hora de carga", () => {
    const g = agrupar([f(3, 10, 1, 900), f(1, 10, 1, 700), f(2, 10, 1, 800)]);
    expect(g[0].filas.map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it("suma el volumen del bloque sin cola de coma flotante", () => {
    const g = agrupar([f(1, 10, 1, 700, 10.1), f(2, 10, 1, 800, 20.2)]);
    expect(g[0].totalM3).toBe(30.3);
  });
});
