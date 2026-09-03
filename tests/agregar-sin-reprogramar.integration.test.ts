// Agregar un cliente NUEVO no debe reprogramar a los que ya estaban.
//
// El Programador arma el día y espera que se quede como lo dejó: si al meter un
// pedido el motor recalculara la planta entera, los clientes ya publicados
// cambiarían de hora sin que nadie lo pidiera (y el DPCR-08 dejaría de coincidir con
// lo acordado). Por eso el motor agenda SOLO el pedido nuevo, en la hora de llegada
// que se le pidió, y cuando se encima con otro cliente lo AVISA en vez de moverlo.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  cancelarPedido,
  cancelarPedidoConMotivo,
  modificarPedido,
  programarPedido,
} from "@/lib/motor/asignacion";
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
    // El aviso tiene que ser accionable: planta, hora, minutos de traslape y cliente.
    const choque = b.avisosChoque!.find((a) => a.startsWith("Choque de carga en "));
    expect(choque, b.avisosChoque!.join(" | ")).toBeDefined();
    expect(choque).toMatch(/se encima \d+ min/);
    expect(choque).toContain("con el de ");
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

  it("editar un pedido tampoco mueve a los demás", async () => {
    // Es el mismo invariante para la edición: en el Modo Manual el sistema no
    // reprograma a terceros, solo re-agenda el pedido que se editó.
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

    const a = await programarPedido({ ...base, cliente_id: clienteA, volumen_total_m3: 22, hora_solicitada: DIA });
    const b = await programarPedido({
      ...base,
      cliente_id: clienteB,
      volumen_total_m3: 11,
      hora_solicitada: aLas(11),
    });
    const antesA = await horarios(a.pedidoId);

    // Sube el volumen de B (2 viajes en vez de 1). Editar no reprograma a nadie.
    const r = await modificarPedido(b.pedidoId, {
      ...base,
      cliente_id: clienteB,
      volumen_total_m3: 22,
      hora_solicitada: aLas(11),
    });
    expect(r.viajes.filter((v) => v.mixerId != null).length).toBe(2);
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

describe("nada se mueve solo: cancelar y volúmenes con decimales", () => {
  const base = (plantelId: number, plantaId: number, disenoId: number) => ({
    diseno_id: disenoId,
    plantel_id: plantelId,
    planta_id: plantaId,
    tipo_descarga: "Canal directo",
    creado_por: "test",
  });

  it("CANCELAR un pedido no adelanta a los demás (el hueco se queda)", async () => {
    // Antes, cancelar recalculaba la cascada de la planta para "cerrar el hueco", y
    // eso adelantaba la hora de los clientes siguientes sin que nadie lo pidiera.
    const { plantelId, plantaId, disenoId } = await escenario();
    const b = base(plantelId, plantaId, disenoId);
    const c1 = await crearCliente(true, 30, 30);
    const c2 = await crearCliente(true, 30, 30);
    const c3 = await crearCliente(true, 30, 30);

    const p1 = await programarPedido({ ...b, cliente_id: c1, volumen_total_m3: 11, hora_solicitada: aLas(8) });
    const p2 = await programarPedido({ ...b, cliente_id: c2, volumen_total_m3: 11, hora_solicitada: aLas(10) });
    const p3 = await programarPedido({ ...b, cliente_id: c3, volumen_total_m3: 11, hora_solicitada: aLas(12) });

    const antes1 = await horarios(p1.pedidoId);
    const antes3 = await horarios(p3.pedidoId);

    await cancelarPedidoConMotivo(p2.pedidoId, "Clima o Lluvia", null, "test");

    // Ni el anterior ni el posterior se movieron: el hueco de las 10:00 queda libre
    // y visible, y es el Programador quien decide si mete algo ahí.
    expect(await horarios(p1.pedidoId)).toEqual(antes1);
    expect(await horarios(p3.pedidoId)).toEqual(antes3);
  });

  it("ELIMINAR un pedido tampoco mueve a los demás", async () => {
    const { plantelId, plantaId, disenoId } = await escenario();
    const b = base(plantelId, plantaId, disenoId);
    const c1 = await crearCliente(true, 30, 30);
    const c2 = await crearCliente(true, 30, 30);

    const p1 = await programarPedido({ ...b, cliente_id: c1, volumen_total_m3: 11, hora_solicitada: aLas(8) });
    const p2 = await programarPedido({ ...b, cliente_id: c2, volumen_total_m3: 11, hora_solicitada: aLas(10) });
    const antes1 = await horarios(p1.pedidoId);

    await cancelarPedido(p2.pedidoId);

    expect(await horarios(p1.pedidoId)).toEqual(antes1);
  });

  it("un volumen con decimales libres (2.2 m³) se guarda y se programa tal cual", async () => {
    const { plantelId, plantaId, disenoId } = await escenario();
    const cliente = await crearCliente(true, 30, 30);
    const r = await programarPedido({
      ...base(plantelId, plantaId, disenoId),
      cliente_id: cliente,
      volumen_total_m3: 2.2,
      hora_solicitada: aLas(8),
    });

    const p = await prisma.pedidos.findUniqueOrThrow({
      where: { id: r.pedidoId },
      select: { volumen_total_m3: true, volumen_programado: true },
    });
    expect(p.volumen_total_m3).toBeCloseTo(2.2, 2);
    expect(p.volumen_programado).toBeCloseTo(2.2, 2);
    // Un solo viaje con los 2.2 m³ exactos: no se redondea a 2.0 ni a 2.5.
    const viajes = await prisma.viajes.findMany({
      where: { pedido_id: r.pedidoId },
      select: { volumen_asignado_m3: true },
    });
    expect(viajes).toHaveLength(1);
    expect(viajes[0].volumen_asignado_m3).toBeCloseTo(2.2, 2);
    expect(r.volumenSinCubrir).toBe(0);
  });

  it("un volumen de 7.3 m³ tampoco se redondea al planificar varios viajes", async () => {
    const { plantelId, plantaId, disenoId } = await escenario(45, [[5, 4]]);
    const cliente = await crearCliente(true, 30, 30);
    const r = await programarPedido({
      ...base(plantelId, plantaId, disenoId),
      cliente_id: cliente,
      volumen_total_m3: 7.3,
      hora_solicitada: aLas(8),
    });
    const viajes = await prisma.viajes.findMany({
      where: { pedido_id: r.pedidoId },
      select: { volumen_asignado_m3: true },
    });
    // La suma de los viajes es el volumen pedido, al centímetro cúbico.
    const suma = viajes.reduce((a, v) => a + v.volumen_asignado_m3, 0);
    expect(suma).toBeCloseTo(7.3, 2);
  });
});
