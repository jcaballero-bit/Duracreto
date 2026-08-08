// Motor de 2 pasadas (puro): huecos + orden anclas-primero / relleno best-fit.
import { describe, expect, it } from "vitest";
import {
  calcularHuecos,
  planificarDosPasadas,
  type PedidoOrg,
} from "@/lib/motor/organizador";

const H = 3_600_000;
const M = 60_000;
const base = Date.UTC(2026, 0, 1, 0, 0, 0);
const at = (h: number, min = 0) => base + h * H + min * M;

describe("calcularHuecos", () => {
  it("devuelve los intervalos libres entre ocupados (>= margen)", () => {
    const huecos = calcularHuecos(
      [
        { inicioMs: at(9), finMs: at(10) },
        { inicioMs: at(11), finMs: at(12) },
      ],
      at(8),
      at(14),
      10,
    );
    expect(huecos.map((h) => [h.inicioMs, h.finMs])).toEqual([
      [at(8), at(9)],
      [at(10), at(11)],
      [at(12), at(14)],
    ]);
  });

  it("omite huecos menores al margen y fusiona solapados", () => {
    const huecos = calcularHuecos(
      [
        { inicioMs: at(9), finMs: at(10) },
        { inicioMs: at(9, 30), finMs: at(10, 5) }, // solapa con el anterior
      ],
      at(8),
      at(10, 5),
      10,
    );
    // Ocupado fusionado [9:00,10:05]; hueco [8:00,9:00] (60m) sí; sin hueco de cola (0m).
    expect(huecos).toHaveLength(1);
    expect(huecos[0].inicioMs).toBe(at(8));
    expect(huecos[0].finMs).toBe(at(9));
  });
});

describe("planificarDosPasadas", () => {
  const opts = { aperturaMs: at(8), cierreMs: at(20), margenMin: 10 };

  it("anclas primero: un pedido multi-viaje queda antes que un corto", () => {
    const pedidos: PedidoOrg[] = [
      { id: 1, plantaId: 1, esAncla: false, horaFija: false, llegadaMs: at(9), inicioFijoMs: null, duracionMin: 20 },
      { id: 2, plantaId: 1, esAncla: true, horaFija: false, llegadaMs: at(9), inicioFijoMs: null, duracionMin: 60 },
    ];
    const orden = planificarDosPasadas(pedidos, opts);
    const o = Object.fromEntries(orden.map((x) => [x.id, x.orden]));
    expect(o[2]).toBeLessThan(o[1]); // la ancla (multi-viaje) va primero
  });

  it("relleno best-fit: los cortos llenan el hueco ANTES de un ancla de hora fija", () => {
    const pedidos: PedidoOrg[] = [
      // Ancla fija: carga 11:00-11:30 (llega 12:00).
      { id: 10, plantaId: 1, esAncla: true, horaFija: true, llegadaMs: at(12), inicioFijoMs: at(11), duracionMin: 30 },
      // Dos cortos que caben en el hueco [8:00,11:00].
      { id: 11, plantaId: 1, esAncla: false, horaFija: false, llegadaMs: at(9), inicioFijoMs: null, duracionMin: 40 },
      { id: 12, plantaId: 1, esAncla: false, horaFija: false, llegadaMs: at(9), inicioFijoMs: null, duracionMin: 20 },
    ];
    const orden = planificarDosPasadas(pedidos, opts);
    const o = Object.fromEntries(orden.map((x) => [x.id, x.orden]));
    // Los cortos quedan ANTES del ancla fija (llenan el hueco de la mañana).
    expect(o[11]).toBeLessThan(o[10]);
    expect(o[12]).toBeLessThan(o[10]);
    // Best-fit decreciente: el corto más largo (40) se coloca primero.
    expect(o[11]).toBeLessThan(o[12]);
  });

  it("un hueco menor al margen no se usa: el corto se manda a la cola", () => {
    const pedidos: PedidoOrg[] = [
      // Anclas fijas desde la apertura (8:00-8:35 y 8:40-9:40): el único hueco entre
      // ellas es de 5 min (8:35→8:40) y no hay hueco de mañana antes de la primera.
      { id: 20, plantaId: 1, esAncla: true, horaFija: true, llegadaMs: at(8), inicioFijoMs: at(8), duracionMin: 35 },
      { id: 21, plantaId: 1, esAncla: true, horaFija: true, llegadaMs: at(9), inicioFijoMs: at(8, 40), duracionMin: 60 },
      // Corto de 20 min: NO cabe en el hueco de 5 min → se manda a la cola (tras 9:40).
      { id: 22, plantaId: 1, esAncla: false, horaFija: false, llegadaMs: at(9), inicioFijoMs: null, duracionMin: 20 },
    ];
    const orden = planificarDosPasadas(pedidos, opts);
    const o = Object.fromEntries(orden.map((x) => [x.id, x.orden]));
    // El corto queda DESPUÉS de ambas anclas (no se metió en el hueco chico).
    expect(o[22]).toBeGreaterThan(o[20]);
    expect(o[22]).toBeGreaterThan(o[21]);
  });
});
