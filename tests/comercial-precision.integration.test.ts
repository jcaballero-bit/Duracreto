// Precisión de proyección del dashboard comercial, contra Postgres.
//
// Qué mide: lo que el ASESOR proyectó en el Programa Semana contra lo que el cliente
// REALMENTE suministró.
//
// Por qué existe este archivo: la métrica daba 100 % siempre. Comparaba la proyección
// contra lo PROGRAMADO, y el formulario de "Convertir a pedido" pre-llena el volumen con
// el de la proyección — así que se comparaba un número contra su propia copia. Salía
// 100 % al mismo tiempo que las tarjetas de adiciones y cancelaciones mostraban cientos
// de m³ de desviación. La primera prueba de abajo es la que habría detectado eso.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { crearCliente, crearDiseno, crearPlantel, limpiarBD } from "./helpers";
import { calcularDesempeno } from "@/lib/comercial/metricas";

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

// Agosto de 2026; el 19 es miércoles.
const MES = { anio: 2026, mes: 8, zona: null };
const en = (dia: number, h: number, m = 0) => new Date(2026, 7, dia, h, m, 0, 0);

interface Caso {
  /** Lo que el asesor proyectó en el Programa Semana. */
  proyectado: number | null;
  /** Volumen con el que quedó el programa (línea base congelada). */
  programado: number;
  /** Viajes: volumen y si se completaron. */
  viajes: { m3: number; estado: string }[];
  sinCubrir?: number;
  cancelado?: boolean;
}

async function escenario(casos: Caso[]) {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "SM Comercial",
    zona: "Norte",
    esHub: true,
  });
  const asesor = await prisma.asesores.create({
    data: { nombre: "Asesora Prueba", correo: `a${Date.now()}@test.com` },
  });
  const disenoId = await crearDiseno();
  const mixer = await prisma.mixers.create({
    data: { marca: "T", capacidad_m3: 12, plantel_base_id: plantelId, identificador: "M-C1" },
  });

  let dia = 3; // lunes 3 de agosto: días laborales sobrados para el mes
  for (const caso of casos) {
    const clienteId = await crearCliente(true);
    await prisma.clientes.update({ where: { id: clienteId }, data: { asesor_id: asesor.id } });

    const pedido = await prisma.pedidos.create({
      data: {
        cliente_id: clienteId,
        diseno_id: disenoId,
        asesor_id: asesor.id,
        volumen_total_m3: caso.programado,
        volumen_programado: caso.programado,
        hora_solicitada: en(dia, 8),
        plantel_id: plantelId,
        planta_id: plantaId,
        tipo_descarga: "Canal directo",
        creado_por: "prueba",
        ...(caso.cancelado
          ? { estado_pedido: "Cancelado", motivo_cancelacion: "Clima o Lluvia" }
          : {}),
      },
    });

    if (caso.proyectado != null) {
      await prisma.solicitudes_anticipadas.create({
        data: {
          cliente_id: clienteId,
          asesor_id: asesor.id,
          fecha_requerida: en(dia, 0),
          volumen_estimado_m3: caso.proyectado,
          estado: "Programado",
          pedido_id: pedido.id,
          creado_por: "prueba",
        },
      });
    }

    for (const v of caso.viajes) {
      await prisma.viajes.create({
        data: {
          pedido_id: pedido.id,
          planta_id: plantaId,
          mixer_id: mixer.id,
          capacidad_asignada_m3: 11,
          volumen_asignado_m3: v.m3,
          hora_solicitada: en(dia, 8),
          hora_inicio_carga: en(dia, 8),
          estado: v.estado,
        },
      });
    }
    if (caso.sinCubrir) {
      await prisma.viajes.create({
        data: {
          pedido_id: pedido.id,
          planta_id: plantaId,
          capacidad_asignada_m3: 0,
          volumen_asignado_m3: caso.sinCubrir,
          hora_solicitada: en(dia, 8),
          estado: "Programado",
          motivo_asignacion: "Sin cubrir",
        },
      });
    }
    dia += 1;
  }
  return { asesorId: asesor.id };
}

beforeEach(async () => {
  await limpiarBD();
  await prisma.asesores.deleteMany();
});

describe("precisión de proyección", () => {
  it("NO es 100% solo porque el programa copió el volumen proyectado", async () => {
    // El caso real: el asesor proyectó 100, el Programador convirtió y el formulario
    // pre-llenó 100... y el cliente solo coló 60. La proyección se desvió un 40 %.
    await escenario([
      { proyectado: 100, programado: 100, viajes: [{ m3: 60, estado: "Completado" }] },
    ]);
    const r = await calcularDesempeno(MES);
    expect(r.precisionPct).toBe(60);
  });

  it("es 100% cuando el cliente suministró exactamente lo proyectado", async () => {
    await escenario([
      { proyectado: 50, programado: 50, viajes: [{ m3: 50, estado: "Completado" }] },
    ]);
    expect((await calcularDesempeno(MES)).precisionPct).toBe(100);
  });

  it("una ADICIÓN también desvía la proyección (se suministró más)", async () => {
    await escenario([
      {
        proyectado: 40,
        programado: 40,
        viajes: [
          { m3: 40, estado: "Completado" },
          { m3: 10, estado: "Completado" },
        ],
      },
    ]);
    // 50 suministrados sobre 40 proyectados = 25 % de desviación.
    expect((await calcularDesempeno(MES)).precisionPct).toBe(75);
  });

  it("un pedido EN CURSO no cuenta: no marcaría faltante mientras el día sigue", async () => {
    await escenario([
      {
        proyectado: 100,
        programado: 100,
        viajes: [
          { m3: 50, estado: "Completado" },
          { m3: 50, estado: "En ruta" }, // todavía va en camino
        ],
      },
    ]);
    // Sin ningún pedido cerrado no hay nada que medir: la pantalla muestra "—".
    expect((await calcularDesempeno(MES)).precisionPct).toBeNull();
  });

  it("un pedido con volumen SIN CUBRIR tampoco cuenta (es un hueco de flota)", async () => {
    await escenario([
      {
        proyectado: 100,
        programado: 100,
        viajes: [{ m3: 60, estado: "Completado" }],
        sinCubrir: 40,
      },
    ]);
    expect((await calcularDesempeno(MES)).precisionPct).toBeNull();
  });

  it("un pedido sin proyección del asesor no entra en la métrica", async () => {
    await escenario([
      { proyectado: null, programado: 80, viajes: [{ m3: 20, estado: "Completado" }] },
    ]);
    expect((await calcularDesempeno(MES)).precisionPct).toBeNull();
  });

  it("promedia sobre el total del periodo, no pedido por pedido", async () => {
    await escenario([
      { proyectado: 100, programado: 100, viajes: [{ m3: 60, estado: "Completado" }] },
      { proyectado: 100, programado: 100, viajes: [{ m3: 100, estado: "Completado" }] },
    ]);
    // Proyectado 200, suministrado 160 → 20 % de desviación.
    expect((await calcularDesempeno(MES)).precisionPct).toBe(80);
  });

  it("la precisión por asesor usa la misma regla que el total", async () => {
    const { asesorId } = await escenario([
      { proyectado: 100, programado: 100, viajes: [{ m3: 60, estado: "Completado" }] },
    ]);
    const r = await calcularDesempeno(MES);
    const fila = r.asesores.find((f) => f.asesorId === asesorId)!;
    expect(fila.precisionPct).toBe(60);
    expect(fila.precisionPct).toBe(r.precisionPct);
  });

  it("un pedido cancelado sigue fuera de la precisión (ya lo cuentan las cancelaciones)", async () => {
    await escenario([
      { proyectado: 100, programado: 100, viajes: [], cancelado: true },
      { proyectado: 50, programado: 50, viajes: [{ m3: 50, estado: "Completado" }] },
    ]);
    const r = await calcularDesempeno(MES);
    // Solo el segundo pedido entra: 50 de 50 = 100 %. El cancelado aparece como
    // cancelación con su motivo, que es donde corresponde.
    expect(r.precisionPct).toBe(100);
    expect(r.cancelacionesM3Total).toBeGreaterThan(0);
  });
});
