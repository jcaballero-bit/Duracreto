// Agregar un cliente NUEVO no debe reprogramar a los que ya estaban.
//
// El Programador arma el día y espera que se quede como lo dejó: si al meter un
// pedido el motor recalculara la planta entera, los clientes ya publicados
// cambiarían de hora sin que nadie lo pidiera (y el DPCR-08 dejaría de coincidir con
// lo acordado). Por eso el motor agenda SOLO el pedido nuevo, en la hora de llegada
// que se le pidió, y cuando se encima con otro cliente lo AVISA en vez de moverlo.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { programarPedido } from "@/lib/motor/asignacion";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

/** Día de trabajo de la prueba: llegada pedida a las 08:00. */
const DIA = new Date(2026, 7, 20, 8, 0, 0, 0);
const aLas = (h: number, m = 0) => new Date(2026, 7, 20, h, m, 0, 0);

/** Horarios de todos los viajes de un pedido (para comparar antes/después). */
async function horarios(pedidoId: number) {
  const viajes = await prisma.viajes.findMany({
    where: { pedido_id: pedidoId },
    orderBy: { id: "asc" },
    select: { id: true, mixer_id: true, hora_inicio_carga: true, hora_llegada_proyecto: true },
  });
  return viajes.map((v) => ({
    id: v.id,
    mixer: v.mixer_id,
    carga: v.hora_inicio_carga?.getTime() ?? null,
    llegada: v.hora_llegada_proyecto?.getTime() ?? null,
  }));
}

async function escenario(capacidadPlantaM3h = 28, mixers: [number, number][] = [[11, 4]]) {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "SM Insercion",
    zona: "Norte",
    esHub: true,
    capacidadPlantaM3h,
  });
  await crearMixers(plantelId, mixers);
  const disenoId = await crearDiseno();
  return { plantelId, plantaId, disenoId };
}

beforeEach(async () => {
  await limpiarBD();
});

describe("agregar un cliente nuevo", () => {
  it("no le mueve el horario a los clientes que ya estaban programados", async () => {
    const { plantelId, plantaId, disenoId } = await escenario();
    const clienteA = await crearCliente(true, 30, 30);
    const clienteB = await crearCliente(true, 30, 30);
    const base = {
      diseno_id: disenoId,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    };

    // Cliente A: 33 m³ (3 viajes) a las 08:00.
    const a = await programarPedido({
      ...base,
      cliente_id: clienteA,
      volumen_total_m3: 33,
      hora_solicitada: DIA,
    });
    const antesA = await horarios(a.pedidoId);
    expect(antesA.filter((v) => v.mixer != null).length).toBe(3);

    // Cliente B: se agrega DESPUÉS, pidiendo llegar a las 08:30 (en pleno suministro
    // de A). Antes esto reordenaba la planta entera; ahora A no se toca.
    const b = await programarPedido({
      ...base,
      cliente_id: clienteB,
      volumen_total_m3: 11,
      hora_solicitada: aLas(8, 30),
    });

    expect(await horarios(a.pedidoId)).toEqual(antesA);
    // Y B se quedó donde lo pidieron (llegada 08:30), no lo empujaron al final.
    const viajesB = await horarios(b.pedidoId);
    expect(Math.abs(viajesB[0].llegada! - aLas(8, 30).getTime())).toBeLessThan(1000);
  });

  it("avisa del choque con el cliente que ya estaba (misma boca de carga)", async () => {
    const { plantelId, plantaId, disenoId } = await escenario();
    const clienteA = await crearCliente(true, 30, 30);
    const clienteB = await crearCliente(true, 30, 30);
    const base = {
      diseno_id: disenoId,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    };

    await programarPedido({ ...base, cliente_id: clienteA, volumen_total_m3: 11, hora_solicitada: DIA });
    // Mismo minuto de llegada que A: se encima con su carga.
    const b = await programarPedido({
      ...base,
      cliente_id: clienteB,
      volumen_total_m3: 11,
      hora_solicitada: DIA,
    });

    expect(b.avisosChoque?.length ?? 0).toBeGreaterThan(0);
    expect(b.avisosChoque!.join(" ")).toMatch(/encima|misma planta/i);
  });

  it("sin encimarse con nadie no genera aviso", async () => {
    const { plantelId, plantaId, disenoId } = await escenario();
    const clienteA = await crearCliente(true, 30, 30);
    const clienteB = await crearCliente(true, 30, 30);
    const base = {
      diseno_id: disenoId,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    };

    await programarPedido({ ...base, cliente_id: clienteA, volumen_total_m3: 11, hora_solicitada: DIA });
    // Bien separado: a media tarde no choca con nada.
    const b = await programarPedido({
      ...base,
      cliente_id: clienteB,
      volumen_total_m3: 11,
      hora_solicitada: aLas(15),
    });
    expect(b.avisosChoque ?? []).toEqual([]);
  });

  it("tampoco reprograma en un plantel de DOS plantas (Santa Marta / Tegucigalpa)", async () => {
    // La cascada de 2 plantas es una ruta distinta (agenda ambas en paralelo
    // compartiendo la flota): también debe dejar quieto al cliente ya programado.
    const { plantelId, plantaId, disenoId } = await escenario(45, [[11, 6]]);
    const planta2 = await prisma.plantas.create({
      data: { plantel_id: plantelId, nombre: "SANY", capacidad_m3h: 28, tiempo_alistamiento_min: 5 },
    });
    const clienteA = await crearCliente(true, 30, 30);
    const clienteB = await crearCliente(true, 30, 30);
    const base = {
      diseno_id: disenoId,
      plantel_id: plantelId,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    };

    const a = await programarPedido({
      ...base,
      cliente_id: clienteA,
      planta_id: plantaId,
      volumen_total_m3: 44,
      hora_solicitada: DIA,
      usar_ambas_plantas: true,
    });
    const antesA = await horarios(a.pedidoId);

    await programarPedido({
      ...base,
      cliente_id: clienteB,
      planta_id: planta2.id,
      volumen_total_m3: 11,
      hora_solicitada: aLas(8, 20),
    });

    expect(await horarios(a.pedidoId)).toEqual(antesA);
  });

  it("no le quita el mixer a un cliente ya programado: usa otra unidad", async () => {
    // Un solo mixer disponible y dos clientes a la misma hora: el nuevo NO puede
    // robarle la unidad al que ya estaba (su ciclo está comprometido).
    const { plantelId, plantaId, disenoId } = await escenario(28, [[11, 2]]);
    const clienteA = await crearCliente(true, 30, 30);
    const clienteB = await crearCliente(true, 30, 30);
    const base = {
      diseno_id: disenoId,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    };

    const a = await programarPedido({ ...base, cliente_id: clienteA, volumen_total_m3: 11, hora_solicitada: DIA });
    const mixerA = (await horarios(a.pedidoId)).find((v) => v.mixer != null)!.mixer;

    const b = await programarPedido({ ...base, cliente_id: clienteB, volumen_total_m3: 11, hora_solicitada: DIA });
    const mixerB = (await horarios(b.pedidoId)).find((v) => v.mixer != null)!.mixer;

    expect(mixerB).not.toBeNull();
    expect(mixerB).not.toBe(mixerA);
  });
});
