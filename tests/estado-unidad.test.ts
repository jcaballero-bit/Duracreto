// Pruebas del cambio RÁPIDO de estado de unidades + historial (Tanda 2).
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { cambiarEstadoUnidad } from "@/lib/flota/estado-unidad";
import { crearPlantel, limpiarBD } from "./helpers";

async function crearMixer(plantelId: number, estado = "Disponible") {
  const m = await prisma.mixers.create({
    data: { marca: "Test", capacidad_m3: 9, plantel_base_id: plantelId, estado },
  });
  return m.id;
}

async function historialDe(tipo: string, id: number) {
  return prisma.historial_estado_unidad.findMany({
    where: { unidad_tipo: tipo, unidad_id: id },
    orderBy: { fecha_hora: "asc" },
  });
}

describe("cambiarEstadoUnidad (cambio rápido + historial)", () => {
  beforeEach(limpiarBD);

  it("cambia el estado de un mixer y registra el cambio en el historial", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM", zona: "Norte", esHub: true });
    const mixerId = await crearMixer(plantelId);

    const res = await cambiarEstadoUnidad("Mixer", mixerId, "Fuera de servicio", "tester");
    expect(res.ok).toBe(true);

    const mixer = await prisma.mixers.findUnique({ where: { id: mixerId } });
    expect(mixer?.estado).toBe("Fuera de servicio");

    const hist = await historialDe("Mixer", mixerId);
    expect(hist).toHaveLength(1);
    expect(hist[0].estado_anterior).toBe("Disponible");
    expect(hist[0].estado_nuevo).toBe("Fuera de servicio");
    expect(hist[0].usuario).toBe("tester");
  });

  it("acumula una entrada de historial por cada cambio real", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM", zona: "Norte", esHub: true });
    const mixerId = await crearMixer(plantelId);

    await cambiarEstadoUnidad("Mixer", mixerId, "En mantenimiento", "a");
    await cambiarEstadoUnidad("Mixer", mixerId, "Dañado", "b");
    await cambiarEstadoUnidad("Mixer", mixerId, "Disponible", "c");

    const hist = await historialDe("Mixer", mixerId);
    expect(hist).toHaveLength(3);
    expect(hist.map((h) => h.estado_nuevo)).toEqual([
      "En mantenimiento",
      "Dañado",
      "Disponible",
    ]);
  });

  it("no registra nada si el estado no cambia (no-op)", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM", zona: "Norte", esHub: true });
    const mixerId = await crearMixer(plantelId, "Disponible");

    const res = await cambiarEstadoUnidad("Mixer", mixerId, "Disponible", "tester");
    expect(res.ok).toBe(true);
    expect(await historialDe("Mixer", mixerId)).toHaveLength(0);
  });

  it("rechaza tipo de unidad y estado no válidos, y unidad inexistente", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM", zona: "Norte", esHub: true });
    const mixerId = await crearMixer(plantelId);

    expect((await cambiarEstadoUnidad("Nave", mixerId, "Disponible", "x")).ok).toBe(false);
    expect((await cambiarEstadoUnidad("Mixer", mixerId, "Volando", "x")).ok).toBe(false);
    const inexistente = await cambiarEstadoUnidad("Mixer", 999999, "Dañado", "x");
    expect(inexistente.ok).toBe(false);
    expect(inexistente.mensaje).toMatch(/no encontrada/i);
  });

  it("funciona para una bomba (otro tipo de unidad)", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM", zona: "Norte", esHub: true });
    const bomba = await prisma.bombas.create({
      data: { identificador: "B-1", plantel_base_id: plantelId, estado: "Disponible" },
    });

    const res = await cambiarEstadoUnidad("Bomba", bomba.id, "Dañado", "tester");
    expect(res.ok).toBe(true);
    const b = await prisma.bombas.findUnique({ where: { id: bomba.id } });
    expect(b?.estado).toBe("Dañado");
    expect(await historialDe("Bomba", bomba.id)).toHaveLength(1);
  });
});
