// REGLA CRÍTICA del proyecto: el Despacho en vivo NUNCA escribe sobre los `hora_*`
// programados (la línea base del programa y del DPCR-08); solo sella los `ts_*_real`.
//
// Estas pruebas la blindan: registran la programación completa de un día, ejecutan las
// acciones de Despacho y exigen que NINGUNA hora programada cambie. Si cambian, el
// viaje además se mueve de lugar en la pantalla de Despacho (que ordena por hora de
// carga programada) y el Programa DPCR-08 sale distinto al que se publicó.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  agregarViajeManual,
  cambiarPlantaViaje,
  reasignarMixer,
} from "@/lib/motor/asignacion";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

beforeEach(async () => {
  await limpiarBD();
});

const DIA = "2026-08-14";
const d = (hhmm: string) => new Date(`${DIA}T${hhmm}:00`);

/** Foto de la programación de todos los viajes del día: hora_* + planta + mixer. */
async function fotoPrograma() {
  const viajes = await prisma.viajes.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      planta_id: true,
      mixer_id: true,
      hora_solicitada: true,
      hora_inicio_carga: true,
      hora_fin_carga: true,
      hora_salida_planta: true,
      hora_llegada_proyecto: true,
      hora_inicio_descarga: true,
      hora_fin_descarga: true,
      hora_regreso_planta: true,
    },
  });
  return new Map(
    viajes.map((v) => [
      v.id,
      {
        plantaId: v.planta_id,
        mixerId: v.mixer_id,
        // Solo las horas PROGRAMADAS (la linea base intocable desde Despacho).
        horas: [
          v.hora_solicitada,
          v.hora_inicio_carga,
          v.hora_fin_carga,
          v.hora_salida_planta,
          v.hora_llegada_proyecto,
          v.hora_inicio_descarga,
          v.hora_fin_descarga,
          v.hora_regreso_planta,
        ]
          .map((f) => (f ? f.getTime() : null))
          .join("|"),
      },
    ]),
  );
}

/** Ids cuyas horas programadas cambiaron entre dos fotos. */
function horasCambiadas(
  antes: Awaited<ReturnType<typeof fotoPrograma>>,
  despues: Awaited<ReturnType<typeof fotoPrograma>>,
): number[] {
  const cambios: number[] = [];
  for (const [id, a] of antes) {
    const b = despues.get(id);
    if (b && b.horas !== a.horas) cambios.push(id);
  }
  return cambios;
}

/** Plantel con 2 plantas, mixers y 2 clientes con varios viajes programados. */
async function escenario() {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "SM Despacho",
    zona: "Norte",
    esHub: true,
    capacidadPlantaM3h: 45,
  });
  // Segunda planta con OTRA capacidad: si algo recalcula, las horas cambiarian.
  const planta2 = await prisma.plantas.create({
    data: { plantel_id: plantelId, nombre: "SANY", capacidad_m3h: 28, tiempo_alistamiento_min: 5 },
  });
  await crearMixers(plantelId, [[11, 6]]);
  const clienteA = await crearCliente(true, 30, 30);
  const clienteB = await crearCliente(true, 30, 30);
  const disenoId = await crearDiseno();
  const mixers = await prisma.mixers.findMany({
    where: { plantel_base_id: plantelId },
    orderBy: { id: "asc" },
  });

  const viaje = async (clienteId: number, plantaDestino: number, hora: string, mixerIdx: number) =>
    (
      await agregarViajeManual({
        cliente_id: clienteId,
        diseno_id: disenoId,
        plantel_id: plantelId,
        planta_id: plantaDestino,
        mixer_id: mixers[mixerIdx].id,
        volumen: 9,
        inicio_carga: d(hora),
        tipo_descarga: "Canal directo",
        creado_por: "test",
      })
    ).viajeId;

  // Cliente A: 3 viajes en STALO. Cliente B: 2 viajes en STALO (intercalados).
  const a1 = await viaje(clienteA, plantaId, "07:00", 0);
  const b1 = await viaje(clienteB, plantaId, "07:30", 1);
  const a2 = await viaje(clienteA, plantaId, "08:00", 2);
  const b2 = await viaje(clienteB, plantaId, "08:30", 3);
  const a3 = await viaje(clienteA, plantaId, "09:00", 4);

  return { plantelId, plantaId, planta2Id: planta2.id, mixers, a1, b1, a2, b2, a3 };
}

describe("Despacho en vivo no modifica la programación", () => {
  it("cambiar un viaje de planta NO altera ninguna hora programada (ni la suya)", async () => {
    const s = await escenario();
    const antes = await fotoPrograma();

    const res = await cambiarPlantaViaje(s.a2, s.planta2Id);
    expect(res.ok).toBe(true);

    const despues = await fotoPrograma();
    // Lo ÚNICO que cambia es la planta del viaje movido.
    expect(despues.get(s.a2)!.plantaId).toBe(s.planta2Id);
    expect(horasCambiadas(antes, despues)).toEqual([]);
  });

  it("el viaje movido conserva su lugar en el orden de carga de Despacho", async () => {
    const s = await escenario();
    const ordenDe = async () =>
      (
        await prisma.viajes.findMany({
          orderBy: [{ hora_inicio_carga: "asc" }, { id: "asc" }],
          select: { id: true },
        })
      ).map((v) => v.id);
    const antes = await ordenDe();

    await cambiarPlantaViaje(s.a2, s.planta2Id);

    // Despacho ordena por hora de carga programada: el orden debe ser idéntico.
    expect(await ordenDe()).toEqual(antes);
  });

  it("reasignar un mixer LIBRE no altera ninguna hora programada", async () => {
    const s = await escenario();
    const antes = await fotoPrograma();

    // El 6º mixer no está usado por ningún viaje: es un intercambio simple.
    const libre = s.mixers[5].id;
    const res = await reasignarMixer(s.b1, libre);
    expect(res.ok).toBe(true);

    const despues = await fotoPrograma();
    expect(despues.get(s.b1)!.mixerId).toBe(libre);
    expect(horasCambiadas(antes, despues)).toEqual([]);
  });
});

describe("Despacho: las demás acciones tampoco tocan el programa", () => {
  it("avanzar el estado de un viaje solo sella horas REALES", async () => {
    const s = await escenario();
    const antes = await fotoPrograma();

    const { avanzarEstadoViaje } = await import("@/lib/motor/asignacion");
    await avanzarEstadoViaje(s.a1, "En carga");
    await avanzarEstadoViaje(s.a1, "En ruta");

    const despues = await fotoPrograma();
    expect(horasCambiadas(antes, despues)).toEqual([]);
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: s.a1 } });
    expect(v.ts_inicio_carga_real).not.toBeNull(); // la ejecución sí se registra
  });

  it("editar el volumen en Despacho no mueve ninguna hora programada", async () => {
    const s = await escenario();
    const antes = await fotoPrograma();

    const { editarVolumenViaje } = await import("@/lib/motor/asignacion");
    const r = await editarVolumenViaje(s.b2, 7, "test");
    expect(r.ok).toBe(true);

    expect(horasCambiadas(antes, await fotoPrograma())).toEqual([]);
  });

  it("agregar volumen (adición) no reescribe las horas de los viajes YA programados", async () => {
    const s = await escenario();
    const antes = await fotoPrograma();

    const { agregarVolumenAlPedido } = await import("@/lib/motor/asignacion");
    const pedido = await prisma.viajes.findUniqueOrThrow({
      where: { id: s.a1 },
      select: { pedido_id: true },
    });
    await agregarVolumenAlPedido(pedido.pedido_id, 9);

    // Los viajes que ya existían conservan su horario; los nuevos son adiciones.
    expect(horasCambiadas(antes, await fotoPrograma())).toEqual([]);
  });
});

describe("caso La Ceiba: plantel SIN mixers propios (todo es préstamo del hub)", () => {
  /** Hub con flota + plantel dependiente sin mixers propios, como La Ceiba. */
  async function ceiba() {
    const hub = await crearPlantel({ nombre: "Santa Marta Hub", zona: "Norte", esHub: true });
    await crearMixers(hub.plantelId, [[11, 3]]); // la flota vive en el hub
    const dep = await crearPlantel({ nombre: "La Ceiba", zona: "Norte", hubId: hub.plantelId });
    const clienteA = await crearCliente(true, 30, 30);
    const clienteB = await crearCliente(true, 30, 30);
    const disenoId = await crearDiseno();
    const mixers = await prisma.mixers.findMany({
      where: { plantel_base_id: hub.plantelId },
      orderBy: { id: "asc" },
    });

    const viaje = async (clienteId: number, hora: string, mixerIdx: number) =>
      (
        await agregarViajeManual({
          cliente_id: clienteId,
          diseno_id: disenoId,
          plantel_id: dep.plantelId,
          planta_id: dep.plantaId,
          mixer_id: mixers[mixerIdx].id,
          volumen: 9,
          inicio_carga: d(hora),
          tipo_descarga: "Canal directo",
          creado_por: "test",
        })
      ).viajeId;

    return {
      plantelId: dep.plantelId,
      plantaId: dep.plantaId,
      mixers,
      v1: await viaje(clienteA, "07:00", 0),
      v2: await viaje(clienteB, "08:00", 1),
      v3: await viaje(clienteA, "09:00", 2),
    };
  }

  it("cambiar el mixer a uno YA OCUPADO no mueve los horarios de la programación", async () => {
    const s = await ceiba();
    const antes = await fotoPrograma();

    // El mixer del viaje 2 se le da al viaje 1: sus ciclos se traslapan, así que el
    // viaje 2 pierde su mixer. Ese es el caso normal en un plantel de puro préstamo.
    const res = await reasignarMixer(s.v1, s.mixers[1].id);
    expect(res.ok).toBe(true);

    const despues = await fotoPrograma();
    expect(despues.get(s.v1)!.mixerId).toBe(s.mixers[1].id);
    // Ningún horario programado se movió — ni el del viaje que quedó sin mixer.
    expect(horasCambiadas(antes, despues)).toEqual([]);
  });

  it("el viaje que perdió el mixer conserva su horario y queda para reasignar a mano", async () => {
    const s = await ceiba();
    const antes = await fotoPrograma();

    await reasignarMixer(s.v1, s.mixers[1].id);

    const v2 = await prisma.viajes.findUniqueOrThrow({ where: { id: s.v2 } });
    // Conserva su hora de carga programada (no se recalcula nada).
    expect(v2.hora_inicio_carga!.getTime()).toBe(
      antes.get(s.v2)!.horas.split("|").map(Number)[1],
    );
  });
});
