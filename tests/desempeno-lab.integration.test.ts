// Desempeño de laboratoristas contra Postgres.
//
// Lo que más importa: que el universo sea lo que el laboratorista PUDO hacer (viajes
// que llegaron, programas que ya despacharon) y que la zona acote al Jefe de
// Laboratorio pero no al Gerente de Control de Calidad.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { crearCliente, crearDiseno, crearPlantel, limpiarBD } from "./helpers";
import {
  calcularDesempenoLaboratorio,
  pendientesDeFinalizar,
} from "@/lib/calidad/desempeno-datos";

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

const DIA = new Date(2027, 4, 12, 8, 0);
const RANGO = { desde: new Date(2027, 4, 1), hasta: new Date(2027, 5, 1) };
const h = (hh: number, mm = 0) => new Date(2027, 4, 12, hh, mm);

let seq = 0;
async function crearLab(nombre: string, zona: string | null) {
  seq += 1;
  const u = await prisma.user.create({
    data: {
      name: nombre,
      email: `lab${seq}@test.com`,
      zona,
      activo: true,
      roles: { create: [{ rol: "Laboratorista" }] },
    },
  });
  return u.id;
}

/**
 * Un programa con sus viajes y, opcionalmente, las lecturas de calidad.
 *
 * `viajes[i].llegada` en `null` = el mixer no llegó a obra (no es medible).
 * `rev` / `temp` = lecturas de obra capturadas.
 */
async function programa(o: {
  plantelId: number;
  plantaId: number;
  labIds: string[];
  finalizado?: boolean;
  viajes: {
    estado?: string;
    llegada?: Date | null;
    finCarga?: Date | null;
    rev?: number | null;
    temp?: number | null;
    revPlanta?: number | null;
    tempPlanta?: number | null;
    muestraObra?: boolean;
    capturaEn?: Date;
  }[];
}) {
  const clienteId = await crearCliente(true);
  const disenoId = await crearDiseno();
  const mixer = await prisma.mixers.create({
    data: { marca: "T", capacidad_m3: 12, plantel_base_id: o.plantelId },
  });
  const pedido = await prisma.pedidos.create({
    data: {
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: o.viajes.length * 11,
      volumen_programado: o.viajes.length * 11,
      hora_solicitada: DIA,
      plantel_id: o.plantelId,
      planta_id: o.plantaId,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    },
  });
  for (const labId of o.labIds) {
    await prisma.asignaciones_laboratorista.create({
      data: { pedido_id: pedido.id, laboratorista_id: labId, creado_por: "test" },
    });
  }
  if (o.finalizado) {
    await prisma.control_calidad_general.create({
      data: { pedido_id: pedido.id, laboratorista_id: o.labIds[0] ?? null },
    });
  }
  for (const [i, v] of o.viajes.entries()) {
    const viaje = await prisma.viajes.create({
      data: {
        pedido_id: pedido.id,
        planta_id: o.plantaId,
        mixer_id: mixer.id,
        capacidad_asignada_m3: 11,
        volumen_asignado_m3: 11,
        hora_solicitada: DIA,
        hora_inicio_carga: h(7, i * 20),
        estado: v.estado ?? "Completado",
        ts_llegada_real: v.llegada ?? null,
        ts_fin_carga_real: v.finCarga ?? null,
      },
      select: { id: true },
    });
    const hayLectura =
      v.rev != null || v.temp != null || v.revPlanta != null || v.tempPlanta != null || v.muestraObra;
    if (hayLectura) {
      await prisma.control_calidad_viaje.create({
        data: {
          viaje_id: viaje.id,
          revenimiento_obra: v.rev ?? null,
          temperatura_concreto: v.temp ?? null,
          revenimiento_planta: v.revPlanta ?? null,
          temperatura_planta: v.tempPlanta ?? null,
          muestra_obra: v.muestraObra ?? false,
          laboratorista_id: o.labIds[0] ?? null,
          ...(v.capturaEn ? { creado_en: v.capturaEn } : {}),
        },
      });
    }
  }
  return pedido.id;
}

const correr = (zona: string | null = null) =>
  calcularDesempenoLaboratorio({ ...RANGO, zona });

beforeEach(async () => {
  await limpiarBD();
  await prisma.user.deleteMany();
  seq = 0;
});

describe("llenado de la información", () => {
  it("cuenta las lecturas capturadas sobre las esperadas", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Lab", zona: "Norte", esHub: true });
    const lab = await crearLab("Ana Lab", "Norte");
    // 3 viajes que llegaron: uno completo, uno a medias, uno sin nada = 3 de 6.
    await programa({
      plantelId, plantaId, labIds: [lab],
      viajes: [
        { llegada: h(10, 0), rev: 5, temp: 30 },
        { llegada: h(11, 0), rev: 5 },
        { llegada: h(12, 0) },
      ],
    });

    const { filas } = await correr();
    const f = filas.find((x) => x.laboratoristaId === lab)!;
    expect(f.viajesEnObra).toBe(3);
    expect(f.camposEsperados).toBe(6);
    expect(f.camposCapturados).toBe(3);
    expect(f.llenadoPct).toBe(50);
    expect(f.lecturasCompletas).toBe(1);
    expect(f.lecturasParciales).toBe(1);
    expect(f.lecturasFaltantes).toBe(1);
  });

  it("un viaje que NO llegó a obra no cuenta en contra", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM NoLl", zona: "Norte", esHub: true });
    const lab = await crearLab("Ana Lab", "Norte");
    await programa({
      plantelId, plantaId, labIds: [lab],
      viajes: [
        { llegada: h(10, 0), rev: 5, temp: 30 },
        { llegada: null, estado: "En carga" }, // aun no llega: no es medible
      ],
    });

    const { filas } = await correr();
    const f = filas.find((x) => x.laboratoristaId === lab)!;
    expect(f.viajesEnObra).toBe(1);
    expect(f.llenadoPct).toBe(100);
  });

  it("suma el papel de SALIDA DE PLANTA de los días en que estuvo asignado", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Pl", zona: "Norte", esHub: true });
    const lab = await crearLab("Ana Lab", "Norte");
    await prisma.asignaciones_laboratorista_planta.create({
      data: {
        laboratorista_id: lab,
        planta_id: plantaId,
        fecha: new Date(2027, 4, 12),
        creado_por: "test",
      },
    });
    // Dos viajes cargaron en esa planta ese dia; uno tiene las dos lecturas de planta.
    await programa({
      plantelId, plantaId, labIds: [],
      viajes: [
        { finCarga: h(7, 20), revPlanta: 6, tempPlanta: 31 },
        { finCarga: h(7, 50) },
      ],
    });

    const { filas } = await correr();
    const f = filas.find((x) => x.laboratoristaId === lab)!;
    expect(f.turnosPlanta).toBe(1);
    expect(f.viajesEnPlanta).toBe(2);
    expect(f.camposEsperados).toBe(4);
    expect(f.camposCapturados).toBe(2);
    expect(f.llenadoPct).toBe(50);
    // Sin programas asignados, la finalizacion no aplica y el llenado vale por el total.
    expect(f.finalizacionPct).toBeNull();
    expect(f.calificacion).toBe(50);
  });

  it("un viaje que aún no terminó de cargar no cuenta en el papel de planta", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM SinFin", zona: "Norte", esHub: true });
    const lab = await crearLab("Ana Lab", "Norte");
    await prisma.asignaciones_laboratorista_planta.create({
      data: { laboratorista_id: lab, planta_id: plantaId, fecha: new Date(2027, 4, 12), creado_por: "test" },
    });
    await programa({
      plantelId, plantaId, labIds: [],
      viajes: [{ finCarga: null, estado: "En carga" }],
    });

    const { filas } = await correr();
    const f = filas.find((x) => x.laboratoristaId === lab)!;
    expect(f.viajesEnPlanta).toBe(0);
    expect(f.llenadoPct).toBeNull();
  });
});

describe("finalización del control de calidad", () => {
  it("mide los programas cerrados sobre los que ya despacharon", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Fin", zona: "Norte", esHub: true });
    const lab = await crearLab("Ana Lab", "Norte");
    // Dos programas despachados: uno cerrado, otro no.
    await programa({
      plantelId, plantaId, labIds: [lab], finalizado: true,
      viajes: [{ llegada: h(10, 0), rev: 5, temp: 30 }],
    });
    await programa({
      plantelId, plantaId, labIds: [lab],
      viajes: [{ llegada: h(11, 0), rev: 5, temp: 30 }],
    });

    const { filas } = await correr();
    const f = filas.find((x) => x.laboratoristaId === lab)!;
    expect(f.programasAsignados).toBe(2);
    expect(f.programasFinalizables).toBe(2);
    expect(f.programasFinalizados).toBe(1);
    expect(f.finalizacionPct).toBe(50);
    expect(f.sinFinalizar).toBe(1);
    // Llenado 100 % y finalizacion 50 % -> 100*0.6 + 50*0.4 = 80.
    expect(f.calificacion).toBe(80);
  });

  it("un programa SIN despacho no cuenta en contra (todavía no se puede cerrar)", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM NoDesp", zona: "Norte", esHub: true });
    const lab = await crearLab("Ana Lab", "Norte");
    await programa({
      plantelId, plantaId, labIds: [lab],
      viajes: [{ estado: "Programado", llegada: null }],
    });

    const { filas } = await correr();
    const f = filas.find((x) => x.laboratoristaId === lab)!;
    expect(f.programasAsignados).toBe(1);
    expect(f.programasFinalizables).toBe(0);
    expect(f.finalizacionPct).toBeNull();
    expect(f.sinFinalizar).toBe(0);
  });

  it("con VARIOS laboratoristas, el programa cuenta para cada uno", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Dos", zona: "Norte", esHub: true });
    const a = await crearLab("Ana Lab", "Norte");
    const b = await crearLab("Beto Lab", "Norte");
    await programa({
      plantelId, plantaId, labIds: [a, b],
      viajes: [{ llegada: h(10, 0), rev: 5, temp: 30 }],
    });

    const { filas } = await correr();
    for (const id of [a, b]) {
      const f = filas.find((x) => x.laboratoristaId === id)!;
      expect(f.programasAsignados, id).toBe(1);
      expect(f.programasFinalizables).toBe(1);
      expect(f.sinFinalizar).toBe(1);
    }
  });
});

describe("ausencia de trabajo no es falla", () => {
  it("un laboratorista sin asignaciones aparece SIN NOTA, no con 0", async () => {
    await crearPlantel({ nombre: "SM Vacio", zona: "Norte", esHub: true });
    const lab = await crearLab("Sin Trabajo", "Norte");

    const { filas, resumen } = await correr();
    const f = filas.find((x) => x.laboratoristaId === lab)!;
    expect(f.sinAsignaciones).toBe(true);
    expect(f.calificacion).toBeNull();
    expect(f.llenadoPct).toBeNull();
    expect(resumen.laboratoristas).toBe(1);
    expect(resumen.evaluados).toBe(0);
  });

  it("y va al final de la tabla, después de los que sí tienen nota", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Ord", zona: "Norte", esHub: true });
    const conNota = await crearLab("Con Nota", "Norte");
    await crearLab("Sin Trabajo", "Norte");
    await programa({
      plantelId, plantaId, labIds: [conNota],
      viajes: [{ llegada: h(10, 0), rev: 5, temp: 30 }],
    });

    const { filas } = await correr();
    expect(filas.at(-1)!.nombre).toBe("Sin Trabajo");
  });
});

describe("alcance por zona", () => {
  it("el Jefe de Laboratorio solo ve los laboratoristas de SU zona", async () => {
    await crearPlantel({ nombre: "SM Zona", zona: "Norte", esHub: true });
    await crearLab("Norte Lab", "Norte");
    await crearLab("Sur Lab", "Centro Sur");

    const norte = await correr("Norte");
    expect(norte.filas.map((f) => f.nombre)).toEqual(["Norte Lab"]);

    // El Gerente de Control de Calidad (zona null) ve a los dos.
    const todos = await correr(null);
    expect(todos.filas.map((f) => f.nombre).sort()).toEqual(["Norte Lab", "Sur Lab"]);
  });

  it("acotado a una zona, no cuenta el trabajo hecho en la OTRA", async () => {
    const norte = await crearPlantel({ nombre: "SM Z", zona: "Norte", esHub: true });
    const sur = await crearPlantel({ nombre: "TG Z", zona: "Centro Sur", esHub: true });
    const lab = await crearLab("Ambas Lab", "Norte");
    await programa({
      plantelId: norte.plantelId, plantaId: norte.plantaId, labIds: [lab],
      viajes: [{ llegada: h(10, 0), rev: 5, temp: 30 }],
    });
    await programa({
      plantelId: sur.plantelId, plantaId: sur.plantaId, labIds: [lab],
      viajes: [{ llegada: h(11, 0) }],
    });

    // Con la zona Norte solo se cuenta el programa del Norte (el completo).
    const f1 = (await correr("Norte")).filas.find((x) => x.laboratoristaId === lab)!;
    expect(f1.programasAsignados).toBe(1);
    expect(f1.llenadoPct).toBe(100);

    // Sin limite de zona se cuentan los dos.
    const f2 = (await correr(null)).filas.find((x) => x.laboratoristaId === lab)!;
    expect(f2.programasAsignados).toBe(2);
    expect(f2.llenadoPct).toBe(50);
  });
});

describe("periodo", () => {
  it("solo cuenta lo del rango pedido", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Rango", zona: "Norte", esHub: true });
    const lab = await crearLab("Ana Lab", "Norte");
    await programa({
      plantelId, plantaId, labIds: [lab],
      viajes: [{ llegada: h(10, 0), rev: 5, temp: 30 }],
    });

    const otroMes = await calcularDesempenoLaboratorio({
      desde: new Date(2027, 5, 1),
      hasta: new Date(2027, 6, 1),
      zona: null,
    });
    const f = otroMes.filas.find((x) => x.laboratoristaId === lab)!;
    expect(f.programasAsignados).toBe(0);
    expect(f.sinAsignaciones).toBe(true);
  });
});

describe("oportunidad de la captura", () => {
  it("mide los minutos entre la llegada y el registro de la lectura", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Op", zona: "Norte", esHub: true });
    const lab = await crearLab("Ana Lab", "Norte");
    // Llego 10:00 y la lectura se registro 10:20 -> 20 min.
    await programa({
      plantelId, plantaId, labIds: [lab],
      viajes: [{ llegada: h(10, 0), rev: 5, temp: 30, capturaEn: h(10, 20) }],
    });

    const { filas } = await correr();
    const f = filas.find((x) => x.laboratoristaId === lab)!;
    expect(f.demoraMedianaMin).toBe(20);
  });

  it("un viaje sin ninguna lectura no aporta demora", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Op2", zona: "Norte", esHub: true });
    const lab = await crearLab("Ana Lab", "Norte");
    await programa({ plantelId, plantaId, labIds: [lab], viajes: [{ llegada: h(10, 0) }] });

    const { filas } = await correr();
    expect(filas.find((x) => x.laboratoristaId === lab)!.demoraMedianaMin).toBeNull();
  });
});

describe("lista de controles sin finalizar", () => {
  it("nombra al cliente y a los laboratoristas, con los viajes sin lectura", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Pend", zona: "Norte", esHub: true });
    const lab = await crearLab("Ana Lab", "Norte");
    await programa({
      plantelId, plantaId, labIds: [lab],
      viajes: [
        { llegada: h(10, 0), rev: 5, temp: 30 },
        { llegada: h(11, 0), rev: 5 }, // le falta la temperatura
      ],
    });

    const p = await pendientesDeFinalizar({ ...RANGO, zona: null });
    expect(p).toHaveLength(1);
    expect(p[0].laboratoristas).toEqual(["Ana Lab"]);
    expect(p[0].viajesDespachados).toBe(2);
    expect(p[0].viajesSinLectura).toBe(1);
    expect(p[0].plantel).toBe("SM Pend");
  });

  it("un programa YA finalizado no aparece", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Cerr", zona: "Norte", esHub: true });
    const lab = await crearLab("Ana Lab", "Norte");
    await programa({
      plantelId, plantaId, labIds: [lab], finalizado: true,
      viajes: [{ llegada: h(10, 0), rev: 5, temp: 30 }],
    });

    expect(await pendientesDeFinalizar({ ...RANGO, zona: null })).toHaveLength(0);
  });

  it("un programa sin despacho tampoco (no se puede cerrar todavía)", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM NoD", zona: "Norte", esHub: true });
    const lab = await crearLab("Ana Lab", "Norte");
    await programa({
      plantelId, plantaId, labIds: [lab],
      viajes: [{ estado: "Programado", llegada: null }],
    });

    expect(await pendientesDeFinalizar({ ...RANGO, zona: null })).toHaveLength(0);
  });

  it("un programa SIN laboratorista asignado no entra en esta lista", async () => {
    // Sin nadie asignado no hay a quien evaluar: es un hueco de asignacion, no de
    // desempeno, y se ve en /laboratorio.
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM SinLab", zona: "Norte", esHub: true });
    await programa({ plantelId, plantaId, labIds: [], viajes: [{ llegada: h(10, 0) }] });

    expect(await pendientesDeFinalizar({ ...RANGO, zona: null })).toHaveLength(0);
  });

  it("se puede filtrar por un laboratorista concreto", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Filt", zona: "Norte", esHub: true });
    const a = await crearLab("Ana Lab", "Norte");
    const b = await crearLab("Beto Lab", "Norte");
    await programa({ plantelId, plantaId, labIds: [a], viajes: [{ llegada: h(10, 0) }] });
    await programa({ plantelId, plantaId, labIds: [b], viajes: [{ llegada: h(11, 0) }] });

    const soloA = await pendientesDeFinalizar({ ...RANGO, zona: null, laboratoristaId: a });
    expect(soloA).toHaveLength(1);
    expect(soloA[0].laboratoristas).toEqual(["Ana Lab"]);
  });
});

describe("resumen del equipo", () => {
  it("pondera por volumen de trabajo, no promedia porcentajes", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Eq", zona: "Norte", esHub: true });
    const mucho = await crearLab("Mucho Lab", "Norte");
    const poco = await crearLab("Poco Lab", "Norte");
    // Mucho: 4 viajes completos. Poco: 1 viaje sin nada.
    await programa({
      plantelId, plantaId, labIds: [mucho], finalizado: true,
      viajes: [0, 1, 2, 3].map((i) => ({ llegada: h(10 + i, 0), rev: 5, temp: 30 })),
    });
    await programa({ plantelId, plantaId, labIds: [poco], viajes: [{ llegada: h(15, 0) }] });

    const { resumen } = await correr();
    // 8 lecturas de 10 = 80 %. El promedio de los porcentajes (100 y 0) daria 50.
    expect(resumen.llenadoPct).toBe(80);
    expect(resumen.finalizacionPct).toBe(50); // 1 de 2 programas cerrados
    expect(resumen.sinFinalizar).toBe(1);
    expect(resumen.evaluados).toBe(2);
  });

  it("sin laboratoristas activos no revienta", async () => {
    await crearPlantel({ nombre: "SM Nadie", zona: "Norte", esHub: true });
    const { filas, resumen } = await correr();
    expect(filas).toEqual([]);
    expect(resumen.laboratoristas).toBe(0);
    expect(resumen.llenadoPct).toBeNull();
  });

  it("un laboratorista INACTIVO no se evalúa", async () => {
    await crearPlantel({ nombre: "SM Inac", zona: "Norte", esHub: true });
    const lab = await crearLab("Baja Lab", "Norte");
    await prisma.user.update({ where: { id: lab }, data: { activo: false } });

    expect((await correr()).filas).toEqual([]);
  });
});
