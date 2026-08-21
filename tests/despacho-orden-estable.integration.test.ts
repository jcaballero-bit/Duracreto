// INVARIANTE: el ORDEN de las tarjetas de Despacho en vivo es el programado y no se
// mueve por nada de lo que se haga durante el día.
//
// El despachador se aprende la fila: "primero Inversiones Fama, luego Terravista".
// Si al cambiar un mixer, mover un viaje de planta, corregir un volumen o agregar un
// cliente la lista se reordena, pierde la referencia y se despacha mal. Por eso aquí
// se compara la SECUENCIA COMPLETA de viajes (la misma que arma la pantalla con
// `ordenarViajesDespacho`) antes y después de cada acción, y de paso el Programa
// DPCR-08, que tampoco debe moverse.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  agregarVolumenAlPedido,
  avanzarEstadoViaje,
  cambiarPlantaViaje,
  corregirHoraReal,
  editarVolumenViaje,
  programarPedido,
  reasignarMixer,
} from "@/lib/motor/asignacion";
import { ordenarViajesDespacho } from "@/lib/despacho/orden";
import { construirSnapshot, ymd } from "@/lib/programa/snapshot";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

/** El día que opera Despacho es HOY. */
function hoyALas(h: number, m = 0): Date {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}
const HOY = hoyALas(0);

/**
 * Secuencia de viajes tal como se ve en Despacho: se arman las mismas claves que
 * `app/despacho/page.tsx` (llegada programada para ordenar los bloques de cliente,
 * hora de carga PROGRAMADA dentro del bloque) y se pasa por la función real.
 */
async function ordenEnPantalla(): Promise<number[]> {
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
      ordenLlegadaMs: (
        v.hora_llegada_proyecto ??
        v.hora_inicio_carga ??
        p.hora_solicitada
      ).getTime(),
      ordenCargaMs: (v.hora_inicio_carga ?? p.hora_solicitada).getTime(),
    })),
  );
  return ordenarViajesDespacho(filas).map((f) => f.id);
}

/** El orden de los viajes que YA existían (ignora los agregados después). */
const ordenDe = (secuencia: number[], ids: number[]) => secuencia.filter((x) => ids.includes(x));

const snapshotHoy = () => construirSnapshot({ fecha: ymd(HOY), zona: "Norte" });

/**
 * Las filas de VIAJE del documento (sin las bandas "Planta: X"). Mover un viaje a la
 * otra planta sí agrega esas bandas —el documento tiene que decir dónde carga cada
 * camión—, pero la secuencia de viajes, su numeración y sus horas no pueden cambiar.
 */
const viajesDelDocumento = (snap: Awaited<ReturnType<typeof snapshotHoy>>) =>
  snap.planteles.flatMap((pl) =>
    pl.pedidos.flatMap((p) => p.filas.filter((f) => f.tipo === "viaje")),
  );

/** Plantel con 2 plantas y 3 clientes programados a distintas horas. */
async function diaProgramado() {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "Santa Marta",
    zona: "Norte",
    esHub: true,
    capacidadPlantaM3h: 45,
  });
  const planta2 = await prisma.plantas.create({
    data: { plantel_id: plantelId, nombre: "SANY", capacidad_m3h: 28, tiempo_alistamiento_min: 5 },
  });
  await crearMixers(plantelId, [[11, 12]]);
  const disenoId = await crearDiseno();
  const base = {
    diseno_id: disenoId,
    plantel_id: plantelId,
    planta_id: plantaId,
    tipo_descarga: "Canal directo",
    creado_por: "test",
  };
  // Tres clientes: 33 m³ a las 7:00, 22 m³ a las 9:00 y 11 m³ a las 11:00.
  const a = await programarPedido({
    ...base,
    cliente_id: await crearCliente(true, 30, 30),
    volumen_total_m3: 33,
    hora_solicitada: hoyALas(7),
  });
  const b = await programarPedido({
    ...base,
    cliente_id: await crearCliente(true, 30, 30),
    volumen_total_m3: 22,
    hora_solicitada: hoyALas(9),
  });
  const c = await programarPedido({
    ...base,
    cliente_id: await crearCliente(true, 30, 30),
    volumen_total_m3: 11,
    hora_solicitada: hoyALas(11),
  });
  const ids = (await prisma.viajes.findMany({ select: { id: true } })).map((v) => v.id);
  return { plantelId, plantaId, planta2, disenoId, a, b, c, ids };
}

beforeEach(async () => {
  await limpiarBD();
});

describe("el orden de Despacho en vivo no se mueve", () => {
  it("cambiar un viaje de PLANTA no lo mueve de lugar", async () => {
    const e = await diaProgramado();
    const antes = await ordenEnPantalla();
    const snapAntes = await snapshotHoy();

    // Se mueve a la otra planta un viaje del medio del día.
    const viaje = e.b.viajes.find((v) => v.mixerId != null)!;
    const res = await cambiarPlantaViaje(viaje.id, e.planta2.id);
    expect(res.ok).toBe(true);

    expect(await ordenEnPantalla()).toEqual(antes);
    // En el DPCR-08 la secuencia de viajes, su numeración y sus horas no cambian…
    const snapDespues = await snapshotHoy();
    expect(viajesDelDocumento(snapDespues)).toEqual(viajesDelDocumento(snapAntes));
    expect(snapDespues.totalZona).toBe(snapAntes.totalZona);
    // …lo único que aparece son las bandas de planta, porque ese pedido ahora carga
    // en las dos (el documento debe decir de dónde sale cada camión).
    const bandas = snapDespues.planteles
      .flatMap((pl) => pl.pedidos)
      .flatMap((p) => p.filas)
      .filter((f) => f.tipo === "planta")
      .map((f) => (f as { nombre: string }).nombre);
    expect(bandas.sort()).toEqual(["SANY", "Santa Marta P1"]);
  });

  it("reasignar el MIXER no mueve de lugar a nadie", async () => {
    const e = await diaProgramado();
    const antes = await ordenEnPantalla();
    const snapAntes = await snapshotHoy();

    const viaje = e.a.viajes.find((v) => v.mixerId != null)!;
    const libre = await prisma.mixers.findFirstOrThrow({
      where: { plantel_base_id: e.plantelId, viajes: { none: {} } },
    });
    const res = await reasignarMixer(viaje.id, libre.id);
    expect(res.ok).toBe(true);

    expect(await ordenEnPantalla()).toEqual(antes);
    // El DPCR-08 sí refleja el mixer nuevo, pero NADA más cambia de sitio.
    const snapDespues = await snapshotHoy();
    expect(snapDespues.planteles[0].pedidos.map((p) => p.cliente)).toEqual(
      snapAntes.planteles[0].pedidos.map((p) => p.cliente),
    );
    expect(snapDespues.totalZona).toBe(snapAntes.totalZona);
  });

  it("corregir el VOLUMEN no mueve de lugar a nadie", async () => {
    const e = await diaProgramado();
    const antes = await ordenEnPantalla();
    const snapAntes = await snapshotHoy();

    for (const v of e.a.viajes.filter((x) => x.mixerId != null).slice(0, 2)) {
      await editarVolumenViaje(v.id, 6, "despachador");
    }

    expect(await ordenEnPantalla()).toEqual(antes);
    expect(await snapshotHoy()).toEqual(snapAntes);
  });

  it("avanzar estados y corregir una HORA REAL no reordena la pantalla", async () => {
    const e = await diaProgramado();
    const antes = await ordenEnPantalla();
    const snapAntes = await snapshotHoy();

    // Se despacha primero un viaje TARDÍO (el del último cliente): aunque su hora
    // real quede antes que la de otros, la lista no se reordena.
    const tardio = e.c.viajes.find((v) => v.mixerId != null)!;
    await avanzarEstadoViaje(tardio.id, "En carga");
    await avanzarEstadoViaje(tardio.id, "En ruta");
    const corr = await corregirHoraReal(tardio.id, "ts_inicio_carga_real", hoyALas(6, 30), "despachador");
    expect(corr.ok).toBe(true);

    expect(await ordenEnPantalla()).toEqual(antes);
    expect(await snapshotHoy()).toEqual(snapAntes);
  });

  it("agregar un VIAJE a un pedido existente deja el orden previo intacto", async () => {
    const e = await diaProgramado();
    const antes = await ordenEnPantalla();
    const snapAntes = await snapshotHoy();

    const res = await agregarVolumenAlPedido(e.a.pedidoId, 9);
    expect(res.viajes.length).toBeGreaterThan(0);

    // Los viajes que ya estaban conservan su secuencia exacta…
    const despues = await ordenEnPantalla();
    expect(ordenDe(despues, e.ids)).toEqual(antes);
    // …y el nuevo aparece (es una adición: no entra al DPCR-08).
    expect(despues.length).toBe(antes.length + 1);
    expect(await snapshotHoy()).toEqual(snapAntes);
  });

  it("agregar un CLIENTE nuevo desde Despacho deja el orden previo intacto", async () => {
    const e = await diaProgramado();
    const antes = await ordenEnPantalla();
    const snapAntes = await snapshotHoy();

    await programarPedido({
      cliente_id: await crearCliente(true, 30, 30),
      diseno_id: e.disenoId,
      plantel_id: e.plantelId,
      planta_id: e.plantaId,
      volumen_total_m3: 11,
      hora_solicitada: hoyALas(8), // en pleno día, entre los ya programados
      tipo_descarga: "Canal directo",
      es_adicion: true, // así lo crea "Adicionar pedido" de Despacho
      creado_por: "despachador",
    });

    const despues = await ordenEnPantalla();
    expect(ordenDe(despues, e.ids)).toEqual(antes);
    expect(despues.length).toBeGreaterThan(antes.length);
    // El programa publicado no cambia: una adición no entra al DPCR-08.
    expect(await snapshotHoy()).toEqual(snapAntes);
  });

  it("todas las acciones seguidas: el orden programado sobrevive el día completo", async () => {
    const e = await diaProgramado();
    const antes = await ordenEnPantalla();
    const snapAntes = await snapshotHoy();

    const vA = e.a.viajes.filter((v) => v.mixerId != null);
    const vB = e.b.viajes.filter((v) => v.mixerId != null);
    const libre = await prisma.mixers.findFirstOrThrow({
      where: { plantel_base_id: e.plantelId, viajes: { none: {} } },
    });

    await cambiarPlantaViaje(vB[0].id, e.planta2.id);
    await reasignarMixer(vA[0].id, libre.id);
    await editarVolumenViaje(vA[1].id, 7, "despachador");
    await avanzarEstadoViaje(vA[0].id, "En carga");
    await corregirHoraReal(vA[0].id, "ts_inicio_carga_real", hoyALas(6, 45), "despachador");
    await agregarVolumenAlPedido(e.b.pedidoId, 5);
    await programarPedido({
      cliente_id: await crearCliente(true, 30, 30),
      diseno_id: e.disenoId,
      plantel_id: e.plantelId,
      planta_id: e.plantaId,
      volumen_total_m3: 8,
      hora_solicitada: hoyALas(10),
      tipo_descarga: "Canal directo",
      es_adicion: true,
      creado_por: "despachador",
    });

    const despues = await ordenEnPantalla();
    expect(ordenDe(despues, e.ids)).toEqual(antes);
    // Y en el programa publicado, los viajes siguen en el mismo orden, con la misma
    // numeración y las mismas horas que en la mañana (solo se sumaron las bandas de
    // planta del pedido que se movió, y las adiciones no entran al DPCR-08).
    const snapDespues = await snapshotHoy();
    expect(viajesDelDocumento(snapDespues)).toEqual(viajesDelDocumento(snapAntes));
    expect(snapDespues.totalZona).toBe(snapAntes.totalZona);
  });
});
