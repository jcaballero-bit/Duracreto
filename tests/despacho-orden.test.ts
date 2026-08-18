// Orden de las tarjetas de Despacho en vivo: mismo criterio que el DPCR-08, pero sin
// partir el suministro de un cliente. Pruebas puras (sin BD).
import { describe, expect, it } from "vitest";
import { ordenarViajesDespacho, type ViajeOrdenable } from "@/lib/despacho/orden";

const hh = (h: number, m = 0) => new Date(2026, 7, 20, h, m, 0, 0).getTime();

/** Viaje mínimo: id, pedido, llegada programada y carga programada. */
function v(
  id: number,
  pedidoId: number,
  llegada: number,
  carga = llegada - 30 * 60_000,
): ViajeOrdenable {
  return { id, pedidoId, ordenLlegadaMs: llegada, ordenCargaMs: carga };
}

describe("ordenarViajesDespacho", () => {
  it("el caso del despachador: los 5 viajes de las 7:00 van seguidos y luego los 2 de las 8:00", () => {
    // Fama (pedido 1): 5 viajes desde las 7:00, cada 20 min.
    const fama = [0, 1, 2, 3, 4].map((i) => v(100 + i, 1, hh(7, i * 20)));
    // Terravista (pedido 2): 2 viajes desde las 8:00 — se INTERCALAN en el tiempo con
    // los últimos de Fama, que es justo lo que antes partía el bloque.
    const terra = [0, 1].map((i) => v(200 + i, 2, hh(8, i * 20)));

    const orden = ordenarViajesDespacho([...terra, ...fama]);
    expect(orden.map((x) => x.pedidoId)).toEqual([1, 1, 1, 1, 1, 2, 2]);
    // Y dentro de cada bloque, en su orden de carga programado.
    expect(orden.slice(0, 5).map((x) => x.id)).toEqual([100, 101, 102, 103, 104]);
    expect(orden.slice(5).map((x) => x.id)).toEqual([200, 201]);
  });

  it("los bloques van por hora de llegada (no por nombre ni por id de pedido)", () => {
    // El pedido 9 llega ANTES que el 3: manda la hora, no el número.
    const orden = ordenarViajesDespacho([v(1, 3, hh(10)), v(2, 9, hh(7)), v(3, 3, hh(11))]);
    expect(orden.map((x) => x.pedidoId)).toEqual([9, 3, 3]);
  });

  it("un cliente que empieza temprano pero termina tarde no se parte", () => {
    // Pedido 1: 7:00 y 12:00. Pedido 2: 9:00. Aun así el bloque 1 va completo primero.
    const orden = ordenarViajesDespacho([v(1, 1, hh(7)), v(2, 2, hh(9)), v(3, 1, hh(12))]);
    expect(orden.map((x) => x.id)).toEqual([1, 3, 2]);
  });

  it("dos pedidos que arrancan a la misma hora quedan cada uno en su bloque", () => {
    const orden = ordenarViajesDespacho([
      v(1, 5, hh(8)),
      v(2, 4, hh(8)),
      v(3, 5, hh(8, 30)),
      v(4, 4, hh(8, 30)),
    ]);
    expect(orden.map((x) => x.pedidoId)).toEqual([4, 4, 5, 5]);
  });

  it("no muta el arreglo original", () => {
    const entrada = [v(1, 2, hh(9)), v(2, 1, hh(7))];
    const copia = [...entrada];
    ordenarViajesDespacho(entrada);
    expect(entrada).toEqual(copia);
  });
});
