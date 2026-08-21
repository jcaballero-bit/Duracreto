// Un viaje AGREGADO desde Despacho es el ÚLTIMO del cliente, y el número que se ve en
// la tarjeta ("Viaje 18 de 18") sigue exactamente el orden de la pantalla.
//
// Caso reportado: se agregó un viaje y salió como "Viaje 17 de 18" —quedó intercalado
// antes del último camión del cliente—. La causa: la colocación solo miraba hasta
// cuándo estaba ocupada la BOCA DE CARGA de la planta, no hasta dónde llegaba la cola
// de ESE cliente. Y aparte, la numeración se calculaba por hora mientras las tarjetas
// se agrupan por cliente, así que podían no coincidir.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { agregarVolumenAlPedido, programarPedido } from "@/lib/motor/asignacion";
import { ordenarViajesDespacho } from "@/lib/despacho/orden";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

/** El día que opera Despacho es HOY. */
function hoyALas(h: number, m = 0): Date {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}
const HOY = hoyALas(0);

/** Viajes de un pedido, en el orden PROGRAMADO de carga. */
async function viajesEnOrden(pedidoId: number) {
  const v = await prisma.viajes.findMany({
    where: { pedido_id: pedidoId, mixer_id: { not: null } },
    orderBy: [{ hora_inicio_carga: "asc" }, { id: "asc" }],
    select: { id: true, hora_inicio_carga: true, es_adicion: true, volumen_asignado_m3: true },
  });
  return v;
}

/**
 * Numeración tal como la calcula la pantalla: se ordenan las tarjetas y se recorren
 * en ese orden asignando el número por cliente.
 */
async function numeracionEnPantalla(): Promise<Map<number, { num: number; total: number }>> {
  const ini = new Date(HOY);
  const fin = new Date(HOY.getFullYear(), HOY.getMonth(), HOY.getDate() + 1);
  const pedidos = await prisma.pedidos.findMany({
    where: { hora_solicitada: { gte: ini, lt: fin }, estado_pedido: "Activo" },
    include: { viajes: { where: { mixer_id: { not: null } } } },
  });
  const filas = pedidos.flatMap((p) =>
    p.viajes.map((v) => ({
      id: v.id,
      pedidoId: p.id,
      clienteId: p.cliente_id,
      ordenLlegadaMs: (
        v.hora_llegada_proyecto ??
        v.hora_inicio_carga ??
        p.hora_solicitada
      ).getTime(),
      ordenCargaMs: (v.hora_inicio_carga ?? p.hora_solicitada).getTime(),
    })),
  );
  const orden = ordenarViajesDespacho(filas);
  const total = new Map<number, number>();
  for (const f of orden) total.set(f.clienteId, (total.get(f.clienteId) ?? 0) + 1);
  const vistos = new Map<number, number>();
  const res = new Map<number, { num: number; total: number }>();
  for (const f of orden) {
    const n = (vistos.get(f.clienteId) ?? 0) + 1;
    vistos.set(f.clienteId, n);
    res.set(f.id, { num: n, total: total.get(f.clienteId) ?? n });
  }
  return res;
}

async function escenario() {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "Santa Marta",
    zona: "Norte",
    esHub: true,
    capacidadPlantaM3h: 45,
  });
  await crearMixers(plantelId, [[11, 8]]);
  const disenoId = await crearDiseno();
  return { plantelId, plantaId, disenoId };
}

beforeEach(async () => {
  await limpiarBD();
});

describe("un viaje agregado es el último del cliente", () => {
  it("se coloca DESPUÉS del último camión de ese cliente", async () => {
    const e = await escenario();
    const r = await programarPedido({
      cliente_id: await crearCliente(true, 30, 30),
      diseno_id: e.disenoId,
      plantel_id: e.plantelId,
      planta_id: e.plantaId,
      volumen_total_m3: 44,
      hora_solicitada: hoyALas(7),
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });
    const antes = await viajesEnOrden(r.pedidoId);
    const ultimoAntes = antes.at(-1)!.hora_inicio_carga!.getTime();

    await agregarVolumenAlPedido(r.pedidoId, 9);

    const despues = await viajesEnOrden(r.pedidoId);
    expect(despues.length).toBe(antes.length + 1);
    // El nuevo es el último de la cola y carga después del que era el último.
    const nuevo = despues.at(-1)!;
    expect(nuevo.es_adicion).toBe(true);
    expect(nuevo.hora_inicio_carga!.getTime()).toBeGreaterThanOrEqual(ultimoAntes);
    // Y los que ya estaban conservan su hora exacta.
    expect(despues.slice(0, antes.length).map((v) => [v.id, v.hora_inicio_carga?.getTime()])).toEqual(
      antes.map((v) => [v.id, v.hora_inicio_carga?.getTime()]),
    );
  });

  it("el número en pantalla es el ÚLTIMO (el caso del 'Viaje 17 de 18')", async () => {
    const e = await escenario();
    const r = await programarPedido({
      cliente_id: await crearCliente(true, 30, 30),
      diseno_id: e.disenoId,
      plantel_id: e.plantelId,
      planta_id: e.plantaId,
      volumen_total_m3: 33,
      hora_solicitada: hoyALas(7),
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });
    const numsAntes = await numeracionEnPantalla();
    const antes = await viajesEnOrden(r.pedidoId);

    await agregarVolumenAlPedido(r.pedidoId, 9);

    const nums = await numeracionEnPantalla();
    const viajes = await viajesEnOrden(r.pedidoId);
    const nuevo = viajes.at(-1)!;
    const info = nums.get(nuevo.id)!;
    expect(info.num).toBe(info.total); // es el último: "Viaje N de N"
    expect(info.total).toBe(viajes.length);
    // Y a los camiones que ya estaban no se les cambia el número.
    for (const v of antes) {
      expect(nums.get(v.id)!.num).toBe(numsAntes.get(v.id)!.num);
    }
  });

  it("aunque otro cliente tenga la planta ocupada hasta más tarde", async () => {
    // La cola de la planta llega hasta la tarde por OTRO cliente; el viaje agregado
    // igual tiene que quedar después del último camión de SU cliente.
    const e = await escenario();
    const base = {
      diseno_id: e.disenoId,
      plantel_id: e.plantelId,
      planta_id: e.plantaId,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    };
    const a = await programarPedido({
      ...base,
      cliente_id: await crearCliente(true, 30, 30),
      volumen_total_m3: 22,
      hora_solicitada: hoyALas(7),
    });
    await programarPedido({
      ...base,
      cliente_id: await crearCliente(true, 30, 30),
      volumen_total_m3: 22,
      hora_solicitada: hoyALas(15), // otro cliente ocupa la planta por la tarde
    });

    const antes = await viajesEnOrden(a.pedidoId);
    await agregarVolumenAlPedido(a.pedidoId, 9);
    const despues = await viajesEnOrden(a.pedidoId);
    const nuevo = despues.at(-1)!;

    expect(nuevo.hora_inicio_carga!.getTime()).toBeGreaterThanOrEqual(
      antes.at(-1)!.hora_inicio_carga!.getTime(),
    );
    const nums = await numeracionEnPantalla();
    const info = nums.get(nuevo.id)!;
    expect(info.num).toBe(info.total);
  });

  it("el caso real: el cliente reparte en 2 plantas y una tiene la cola corta", async () => {
    // Aqui fallaba: la boca de carga de la planta a la que va la adicion queda libre
    // temprano, mientras el ultimo camion del cliente carga en la OTRA planta a media
    // tarde. Mirando solo la planta, la adicion se colocaba ANTES de ese camion.
    const e = await escenario();
    const planta2 = await prisma.plantas.create({
      data: { plantel_id: e.plantelId, nombre: "SANY", capacidad_m3h: 28, tiempo_alistamiento_min: 5 },
    });
    const clienteId = await crearCliente(true, 30, 30);
    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: e.disenoId,
      plantel_id: e.plantelId,
      planta_id: e.plantaId,
      volumen_total_m3: 22,
      hora_solicitada: hoyALas(7),
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });
    // El ULTIMO camion del cliente carga a las 5 p.m. en la otra planta.
    const viajes = await viajesEnOrden(r.pedidoId);
    const tarde = hoyALas(17);
    await prisma.viajes.update({
      where: { id: viajes.at(-1)!.id },
      data: {
        planta_id: planta2.id,
        hora_inicio_carga: tarde,
        hora_fin_carga: new Date(tarde.getTime() + 20 * 60000),
        hora_llegada_proyecto: new Date(tarde.getTime() + 50 * 60000),
      },
    });

    await agregarVolumenAlPedido(r.pedidoId, 9);

    const despues = await viajesEnOrden(r.pedidoId);
    const nuevo = despues.at(-1)!;
    expect(nuevo.es_adicion).toBe(true);
    // Tiene que cargar DESPUES del camion de las 5 p.m., no a media mañana.
    expect(nuevo.hora_inicio_carga!.getTime()).toBeGreaterThanOrEqual(tarde.getTime());
    const nums = await numeracionEnPantalla();
    const info = nums.get(nuevo.id)!;
    expect(info.num).toBe(info.total); // y sale como el ULTIMO viaje del cliente
  });

  it("dos viajes agregados seguidos quedan uno tras otro, al final", async () => {
    const e = await escenario();
    const r = await programarPedido({
      cliente_id: await crearCliente(true, 30, 30),
      diseno_id: e.disenoId,
      plantel_id: e.plantelId,
      planta_id: e.plantaId,
      volumen_total_m3: 22,
      hora_solicitada: hoyALas(7),
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });
    await agregarVolumenAlPedido(r.pedidoId, 9);
    await agregarVolumenAlPedido(r.pedidoId, 9);

    const v = await viajesEnOrden(r.pedidoId);
    expect(v.filter((x) => x.es_adicion).length).toBe(2);
    // Las dos adiciones son las dos últimas de la cola.
    expect(v.slice(-2).every((x) => x.es_adicion)).toBe(true);
    const nums = await numeracionEnPantalla();
    expect(nums.get(v.at(-1)!.id)!.num).toBe(v.length);
  });
});

describe("la numeración sigue el orden de la pantalla", () => {
  it("nunca salta: dos tarjetas seguidas del mismo cliente llevan números consecutivos", async () => {
    // Un cliente con DOS pedidos el mismo día (el caso que producía "Viaje 4" seguido
    // de "Viaje 7"): la numeración recorre las tarjetas tal como se ven.
    const e = await escenario();
    const clienteId = await crearCliente(true, 30, 30);
    const base = {
      cliente_id: clienteId,
      diseno_id: e.disenoId,
      plantel_id: e.plantelId,
      planta_id: e.plantaId,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    };
    await programarPedido({ ...base, volumen_total_m3: 33, hora_solicitada: hoyALas(7) });
    await programarPedido({ ...base, volumen_total_m3: 22, hora_solicitada: hoyALas(13) });

    const nums = await numeracionEnPantalla();
    // En el orden de pantalla, los números del cliente van 1,2,3,… sin huecos.
    const ini = new Date(HOY);
    const fin = new Date(HOY.getFullYear(), HOY.getMonth(), HOY.getDate() + 1);
    const pedidos = await prisma.pedidos.findMany({
      where: { hora_solicitada: { gte: ini, lt: fin }, cliente_id: clienteId },
      include: { viajes: { where: { mixer_id: { not: null } } } },
    });
    const filas = pedidos.flatMap((p) =>
      p.viajes.map((v) => ({
        id: v.id,
        pedidoId: p.id,
        ordenLlegadaMs: (v.hora_llegada_proyecto ?? v.hora_inicio_carga ?? p.hora_solicitada).getTime(),
        ordenCargaMs: (v.hora_inicio_carga ?? p.hora_solicitada).getTime(),
      })),
    );
    const secuencia = ordenarViajesDespacho(filas).map((f) => nums.get(f.id)!.num);
    expect(secuencia).toEqual(secuencia.map((_, i) => i + 1));
  });
});
