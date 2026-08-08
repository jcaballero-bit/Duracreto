// Caso real: la planta NO debe quedar parada esperando que regrese un mixer de la
// capacidad "ideal" (11 m³) si hay mixers de 7/9 disponibles en el patio. Prioridad
// nueva: planta siempre cargando > minimizar viajes.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { programarPedido } from "@/lib/motor/asignacion";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

const DIA = new Date("2026-08-01T08:00:00");

beforeEach(async () => {
  await limpiarBD();
});

/** Máximo hueco (min) entre el fin de carga de un viaje y el inicio del siguiente,
 *  ordenados por inicio de carga. 0 = la planta cargó de forma CONTINUA. */
async function maxHuecoCargaMin(pedidoId: number): Promise<number> {
  const viajes = await prisma.viajes.findMany({
    where: { pedido_id: pedidoId, mixer_id: { not: null } },
    select: { hora_inicio_carga: true, hora_fin_carga: true },
  });
  const ord = viajes
    .filter((v) => v.hora_inicio_carga && v.hora_fin_carga)
    .sort((a, b) => a.hora_inicio_carga!.getTime() - b.hora_inicio_carga!.getTime());
  let maxGap = 0;
  for (let i = 1; i < ord.length; i++) {
    const gap = (ord[i].hora_inicio_carga!.getTime() - ord[i - 1].hora_fin_carga!.getTime()) / 60000;
    maxGap = Math.max(maxGap, gap);
  }
  return maxGap;
}

describe("prioridad: planta siempre cargando (no esperar la capacidad ideal)", () => {
  it("1 planta: pocos mixers de 11 + 7/9 libres → carga continua, sin esperar al 11", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "Hub", zona: "Norte", esHub: true });
    // Un solo mixer de 11 m³; varios de 9 y 7 disponibles en el patio.
    await crearMixers(plantelId, [
      [11, 1],
      [9, 3],
      [7, 3],
    ]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 40,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Directo",
      creado_por: "test",
    });

    expect(r.volumenSinCubrir).toBe(0);
    const conMixer = await prisma.viajes.findMany({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
      select: { capacidad_asignada_m3: true, volumen_asignado_m3: true },
    });
    // Se cubrió todo el volumen.
    expect(conMixer.reduce((s, v) => s + v.volumen_asignado_m3, 0)).toBe(40);
    // Usó otras capacidades además del 11 (no esperó a que el único 11 regresara).
    expect(conMixer.some((v) => v.capacidad_asignada_m3 !== 11)).toBe(true);
    // La planta cargó de forma CONTINUA: cero tiempo muerto entre cargas.
    expect(await maxHuecoCargaMin(r.pedidoId)).toBe(0);
  });

  it("2 plantas (tipo Santa Marta): mismo caso, la planta no queda parada", async () => {
    const plantel = await prisma.planteles.create({
      data: {
        nombre: "SM Test",
        zona: "Norte",
        capacidad_dosificacion_m3h: 45,
        plantas: {
          create: [
            { nombre: "STALO", capacidad_m3h: 45 },
            { nombre: "SANY", capacidad_m3h: 50 },
          ],
        },
      },
      include: { plantas: true },
    });
    await prisma.planteles.update({ where: { id: plantel.id }, data: { hub_id: plantel.id } });
    const stalo = plantel.plantas.find((p) => p.nombre === "STALO")!;
    await crearMixers(plantel.id, [
      [11, 2],
      [9, 3],
      [7, 3],
    ]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 55,
      hora_solicitada: DIA,
      plantel_id: plantel.id,
      planta_id: stalo.id,
      tipo_descarga: "Directo",
      creado_por: "test",
    });

    expect(r.volumenSinCubrir).toBe(0);
    const conMixer = await prisma.viajes.findMany({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
      select: { capacidad_asignada_m3: true, volumen_asignado_m3: true },
    });
    expect(conMixer.reduce((s, v) => s + v.volumen_asignado_m3, 0)).toBe(55);
    expect(conMixer.some((v) => v.capacidad_asignada_m3 !== 11)).toBe(true);
    expect(await maxHuecoCargaMin(r.pedidoId)).toBe(0);
  });
});
