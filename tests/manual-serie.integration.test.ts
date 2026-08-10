// Generar EN SERIE (modo manual) + deshacer la serie como bloque, contra la BD.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { generarViajesEnSerie, eliminarViajesManual } from "@/lib/motor/asignacion";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

const MIN = 60_000;
beforeEach(async () => {
  await limpiarBD();
});

describe("generar en serie — horas y asignaciones exactas", () => {
  it("(a) 19 viajes cada 15 min alternando 2 plantas y rotando 7 mixers; (b) deshacer todo", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Serie", zona: "Norte", esHub: true });
    const sany = await prisma.plantas.create({ data: { plantel_id: plantelId, nombre: "SANY", capacidad_m3h: 50 } });
    await crearMixers(plantelId, [[11, 7]]);
    const clienteId = await crearCliente(true, 30, 30);
    const disenoId = await crearDiseno();
    const mixers = await prisma.mixers.findMany({ where: { plantel_base_id: plantelId }, orderBy: { id: "asc" } });
    const mixerIds = mixers.map((m) => m.id);
    const plantaIds = [plantaId, sany.id];
    const inicio = new Date("2026-08-10T07:00:00");

    const { viajeIds } = await generarViajesEnSerie({
      cliente_id: clienteId,
      diseno_id: disenoId,
      plantel_id: plantelId,
      plantaIds,
      mixerIds,
      volumen: 11,
      cantidad: 19,
      frecuenciaMin: 15,
      inicio_carga: inicio,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });
    expect(viajeIds.length).toBe(19);

    const viajes = await prisma.viajes.findMany({
      where: { id: { in: viajeIds } },
      orderBy: { hora_inicio_carga: "asc" },
      select: { hora_inicio_carga: true, planta_id: true, mixer_id: true },
    });
    expect(viajes.length).toBe(19);
    for (let i = 0; i < 19; i++) {
      expect(viajes[i].hora_inicio_carga!.getTime()).toBe(inicio.getTime() + i * 15 * MIN);
      expect(viajes[i].planta_id).toBe(plantaIds[i % 2]);
      expect(viajes[i].mixer_id).toBe(mixerIds[i % 7]);
    }

    // (b) Deshacer la serie completa como un bloque → no queda ninguno.
    await eliminarViajesManual(viajeIds);
    const quedan = await prisma.viajes.count({ where: { id: { in: viajeIds } } });
    expect(quedan).toBe(0);
  });
});
