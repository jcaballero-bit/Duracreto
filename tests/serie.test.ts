import { describe, expect, it } from "vitest";
import { planificarSerie } from "@/lib/motor/serie";

const MIN = 60_000;

describe("planificarSerie", () => {
  it("19 viajes cada 15 min alternando 2 plantas y rotando 7 mixers", () => {
    const plantaIds = [100, 200];
    const mixerIds = [1, 2, 3, 4, 5, 6, 7];
    const plan = planificarSerie({ cantidad: 19, frecuenciaMin: 15, inicioMs: 0, plantaIds, mixerIds });
    expect(plan.length).toBe(19);
    for (let i = 0; i < 19; i++) {
      expect(plan[i].inicioCargaMs).toBe(i * 15 * MIN); // cadencia exacta
      expect(plan[i].plantaId).toBe(plantaIds[i % 2]); // alterna plantas
      expect(plan[i].mixerId).toBe(mixerIds[i % 7]); // rota mixers
    }
    // Puntos concretos.
    expect(plan[7]).toMatchObject({ inicioCargaMs: 105 * MIN, plantaId: 200, mixerId: 1 });
    expect(plan[14]).toMatchObject({ inicioCargaMs: 210 * MIN, plantaId: 100, mixerId: 1 });
  });

  it("cantidad 0 o sin plantas/mixers → serie vacía", () => {
    expect(planificarSerie({ cantidad: 0, frecuenciaMin: 15, inicioMs: 0, plantaIds: [1], mixerIds: [1] })).toEqual([]);
    expect(planificarSerie({ cantidad: 5, frecuenciaMin: 15, inicioMs: 0, plantaIds: [], mixerIds: [1] })).toEqual([]);
    expect(planificarSerie({ cantidad: 5, frecuenciaMin: 15, inicioMs: 0, plantaIds: [1], mixerIds: [] })).toEqual([]);
  });
});
