// Reporte de tiempos de descarga y esperas, contra Postgres.
//
// Cubre los casos (a)–(e) de la validación pedida, más el enforcement por rol: el
// filtro de la URL nunca amplía el alcance y un Jefe de Planta solo ve sus planteles.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";
import { calcularDescargas } from "@/lib/reportes/descargas-datos";
import { alcanceDeParams, rangoDeParams } from "@/lib/reportes/filtro";
import { UMBRALES_DESCARGA_DEFAULT } from "@/lib/reportes/descargas";
import { descargasACsv } from "@/lib/reportes/descargas-csv";

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "u1", name: "Admin", email: "a@test.com" } }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

const DIA = new Date(2026, 8, 10, 8, 0);
const U = UMBRALES_DESCARGA_DEFAULT; // espera 15 min, variabilidad 10 min, tolerancia 25 %
const RANGO = { desde: new Date(2026, 8, 1), hasta: new Date(2026, 9, 1) };
const h = (hh: number, mm = 0) => new Date(2026, 8, 10, hh, mm);

/**
 * Crea un pedido con sus viajes y los timestamps reales indicados. `frecuencia` es la
 * descarga programada; un tramo en `null` deja ese timestamp sin capturar.
 */
async function programa(o: {
  plantelId: number;
  plantaId: number;
  clienteId: number;
  frecuencia: number | null;
  viajes: { llegada?: Date | null; inicio?: Date | null; fin?: Date | null; carga?: Date | null; regreso?: Date | null; vol?: number }[];
}) {
  const disenoId = await crearDiseno();
  const mixer = await prisma.mixers.create({
    data: { marca: "T", capacidad_m3: 12, plantel_base_id: o.plantelId, identificador: `MX-${o.clienteId}` },
  });
  const pedido = await prisma.pedidos.create({
    data: {
      cliente_id: o.clienteId,
      diseno_id: disenoId,
      volumen_total_m3: o.viajes.reduce((a, v) => a + (v.vol ?? 11), 0),
      volumen_programado: o.viajes.reduce((a, v) => a + (v.vol ?? 11), 0),
      hora_solicitada: DIA,
      plantel_id: o.plantelId,
      planta_id: o.plantaId,
      tipo_descarga: "Canal directo",
      frecuencia_entre_camiones_min: o.frecuencia,
      creado_por: "test",
    },
  });
  const ids: number[] = [];
  for (const [i, v] of o.viajes.entries()) {
    const creado = await prisma.viajes.create({
      data: {
        pedido_id: pedido.id,
        planta_id: o.plantaId,
        mixer_id: mixer.id,
        capacidad_asignada_m3: 11,
        volumen_asignado_m3: v.vol ?? 11,
        hora_solicitada: DIA,
        hora_inicio_carga: h(7, i * 20),
        estado: "Completado",
        ts_inicio_carga_real: v.carga ?? null,
        ts_llegada_real: v.llegada ?? null,
        ts_inicio_descarga_real: v.inicio ?? null,
        ts_fin_descarga_real: v.fin ?? null,
        ts_regreso_real: v.regreso ?? null,
      },
      select: { id: true },
    });
    ids.push(creado.id);
  }
  return { pedidoId: pedido.id, viajeIds: ids };
}

const correr = (plantelIds: number[], clienteId: number | null = null) =>
  calcularDescargas({ ...RANGO, plantelIds, clienteId, umbrales: U });

beforeEach(async () => {
  await limpiarBD();
});

describe("(a) desviación de la descarga", () => {
  it("15 min programados y 22 reales dan +7 min (+47%) en rojo", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Desc", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 1]]);
    const clienteId = await crearCliente(true);
    await programa({
      plantelId, plantaId, clienteId, frecuencia: 15,
      viajes: [{ llegada: h(10, 10), inicio: h(10, 15), fin: h(10, 37) }],
    });

    const r = await correr([plantelId]);
    expect(r.detalle).toHaveLength(1);
    const v = r.detalle[0];
    expect(v.programadaMin).toBe(15);
    expect(v.realMin).toBe(22);
    expect(v.desviacionMin).toBe(7);
    expect(v.desviacionPct).toBe(47);
    expect(v.tono).toBe("danger");
  });
});

describe("(b) espera en obra", () => {
  it("llegó 10:15 e inició descarga 10:47 = 32 min de espera", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Esp", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 1]]);
    const clienteId = await crearCliente(true);
    await programa({
      plantelId, plantaId, clienteId, frecuencia: 15,
      viajes: [{ llegada: h(10, 15), inicio: h(10, 47), fin: h(11, 2) }],
    });

    const r = await correr([plantelId]);
    expect(r.detalle[0].esperaMin).toBe(32);
    expect(r.detalle[0].esperaExcesiva).toBe(true);
    expect(r.resumen.esperasSobreUmbral).toBe(1);
    // 32 min = 0.5 h de mixer parado.
    expect(r.resumen.horasMixerEspera).toBeCloseTo(0.5, 1);
  });

  it("traduce las horas de espera a viajes equivalentes con el ciclo del periodo", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Eq", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 1]]);
    const clienteId = await crearCliente(true);
    // 3 viajes con 30 min de espera = 90 min. Ciclo real de 90 min (7:00 -> 8:30).
    await programa({
      plantelId, plantaId, clienteId, frecuencia: 15,
      viajes: [0, 1, 2].map((i) => ({
        carga: h(7 + i, 0),
        llegada: h(7 + i, 20),
        inicio: h(7 + i, 50),
        fin: h(8 + i, 5),
        regreso: h(8 + i, 30),
      })),
    });

    const r = await correr([plantelId]);
    expect(r.resumen.esperaTotalMin).toBe(90);
    expect(r.resumen.cicloPromMin).toBe(90);
    expect(r.resumen.viajesEquivalentes).toBe(1);
  });
});

describe("(c) resumen por cliente", () => {
  it("suma bien los minutos excedidos y ordena por ellos", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Res", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 2]]);
    const cA = await crearCliente(true);
    const cB = await crearCliente(true);
    await prisma.clientes.update({ where: { id: cA }, data: { empresa: "Cliente A" } });
    await prisma.clientes.update({ where: { id: cB }, data: { empresa: "Cliente B" } });

    // A: dos viajes que exceden 7 y 3 min. B: uno que no excede.
    await programa({
      plantelId, plantaId, clienteId: cA, frecuencia: 15,
      viajes: [
        { llegada: h(10, 0), inicio: h(10, 5), fin: h(10, 27) }, // 22 -> +7
        { llegada: h(11, 0), inicio: h(11, 5), fin: h(11, 23) }, // 18 -> +3
      ],
    });
    await programa({
      plantelId, plantaId, clienteId: cB, frecuencia: 15,
      viajes: [{ llegada: h(12, 0), inicio: h(12, 5), fin: h(12, 15) }], // 10 -> -5
    });

    const r = await correr([plantelId]);
    expect(r.porCliente[0].cliente).toBe("Cliente A");
    expect(r.porCliente[0].minutosExcedidos).toBe(10);
    expect(r.porCliente[0].fueraDeProgramado).toBe(2);
    expect(r.porCliente[1].cliente).toBe("Cliente B");
    expect(r.porCliente[1].minutosExcedidos).toBe(0);
    // El total del periodo es la suma de las filas.
    expect(r.resumen.minutosExcedidos).toBe(10);
    expect(r.resumen.peorCliente).toEqual({ cliente: "Cliente A", minutos: 10 });
  });
});

describe("(d) datos incompletos", () => {
  it("se reportan aparte y no distorsionan los promedios", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Inc", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 1]]);
    const clienteId = await crearCliente(true);
    await programa({
      plantelId, plantaId, clienteId, frecuencia: 15,
      viajes: [
        { llegada: h(10, 0), inicio: h(10, 5), fin: h(10, 25) }, // real 20, completo
        { llegada: h(11, 0), inicio: h(11, 5), fin: h(11, 15) }, // real 10, completo
        { llegada: h(12, 0), inicio: h(12, 5), fin: null }, // sin fin: incompleto
        { llegada: null, inicio: null, fin: null }, // sin nada
      ],
    });

    const r = await correr([plantelId]);
    expect(r.resumen.viajes).toBe(4);
    expect(r.resumen.viajesMedidos).toBe(2);
    expect(r.resumen.viajesIncompletos).toBe(2);
    expect(r.resumen.coberturaPct).toBe(50);
    // Promedio de 20 y 10 = 15. Contando los incompletos como 0 daría 7.5.
    expect(r.resumen.realProm).toBe(15);
    // El viaje sin fin de descarga SÍ aporta su espera (5 min): no se pierde el dato.
    expect(r.resumen.viajesConEspera).toBe(3);
    const incompletos = r.detalle.filter((v) => !v.completo);
    expect(incompletos).toHaveLength(2);
    expect(incompletos[0].faltantes).toContain("fin de descarga");
  });

  it("un pedido sin frecuencia configurada no se puede medir, y lo dice", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM SF", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 1]]);
    const clienteId = await crearCliente(true);
    await programa({
      plantelId, plantaId, clienteId, frecuencia: null,
      viajes: [{ llegada: h(10, 0), inicio: h(10, 5), fin: h(10, 25) }],
    });

    const r = await correr([plantelId]);
    expect(r.detalle[0].faltantes).toContain("descarga programada");
    expect(r.detalle[0].completo).toBe(false);
    expect(r.resumen.realProm).toBeNull();
    // La duración real SÍ se calcula: lo que falta es contra qué compararla.
    expect(r.detalle[0].realMin).toBe(20);
  });
});

describe("(e) alcance por rol", () => {
  it("un Jefe de Planta solo ve SUS planteles, y el filtro de la URL no lo amplía", async () => {
    const suyo = await crearPlantel({ nombre: "AA Suyo", zona: "Norte", esHub: true });
    const ajeno = await crearPlantel({ nombre: "ZZ Ajeno", zona: "Norte" });
    await crearMixers(suyo.plantelId, [[11, 1]]);
    await crearMixers(ajeno.plantelId, [[11, 1]]);
    const c1 = await crearCliente(true);
    const c2 = await crearCliente(true);
    await programa({
      plantelId: suyo.plantelId, plantaId: suyo.plantaId, clienteId: c1, frecuencia: 15,
      viajes: [{ llegada: h(10, 0), inicio: h(10, 5), fin: h(10, 25) }],
    });
    await programa({
      plantelId: ajeno.plantelId, plantaId: ajeno.plantaId, clienteId: c2, frecuencia: 15,
      viajes: [{ llegada: h(10, 0), inicio: h(10, 5), fin: h(10, 40) }],
    });

    const jefe = calcularAlcance(["JefePlanta"], "Norte", null, null, [suyo.plantelId]);

    // Sin filtro: solo su plantel.
    const propio = await alcanceDeParams(jefe, {});
    expect(propio.plantelIds).toEqual([suyo.plantelId]);
    const r1 = await correr(propio.plantelIds);
    expect(r1.detalle).toHaveLength(1);
    expect(r1.detalle[0].plantel).toBe("AA Suyo");

    // Escribiendo a mano el id del plantel AJENO: no obtiene datos ajenos.
    const forzado = await alcanceDeParams(jefe, { plantel: String(ajeno.plantelId) });
    expect(forzado.plantelIds).toEqual([suyo.plantelId]);
    const r2 = await correr(forzado.plantelIds);
    expect(r2.detalle).toHaveLength(1);
    expect(r2.detalle[0].plantel).toBe("AA Suyo");
  });

  it("un Jefe de Planta SIN planteles asignados no ve nada (no lo ve todo)", async () => {
    const p = await crearPlantel({ nombre: "SM Nada", zona: "Norte", esHub: true });
    await crearMixers(p.plantelId, [[11, 1]]);
    const c = await crearCliente(true);
    await programa({
      plantelId: p.plantelId, plantaId: p.plantaId, clienteId: c, frecuencia: 15,
      viajes: [{ llegada: h(10, 0), inicio: h(10, 5), fin: h(10, 25) }],
    });

    const jefe = calcularAlcance(["JefePlanta"], "Norte", null, null, []);
    const ambito = await alcanceDeParams(jefe, {});
    expect(ambito.plantelIds).toEqual([-1]);
    const r = await correr(ambito.plantelIds);
    expect(r.detalle).toHaveLength(0);
  });

  it("el Administrador ve los dos planteles", async () => {
    const a = await crearPlantel({ nombre: "SM Uno", zona: "Norte", esHub: true });
    const b = await crearPlantel({ nombre: "TG Dos", zona: "Centro Sur", esHub: true });
    await crearMixers(a.plantelId, [[11, 1]]);
    await crearMixers(b.plantelId, [[11, 1]]);
    const c1 = await crearCliente(true);
    const c2 = await crearCliente(true);
    await programa({ plantelId: a.plantelId, plantaId: a.plantaId, clienteId: c1, frecuencia: 15, viajes: [{ llegada: h(10, 0), inicio: h(10, 5), fin: h(10, 25) }] });
    await programa({ plantelId: b.plantelId, plantaId: b.plantaId, clienteId: c2, frecuencia: 15, viajes: [{ llegada: h(10, 0), inicio: h(10, 5), fin: h(10, 25) }] });

    const admin = calcularAlcance(["Administrador"], null, null, null, []);
    const ambito = await alcanceDeParams(admin, {});
    const r = await correr(ambito.plantelIds);
    expect(r.detalle).toHaveLength(2);
  });
});

describe("universo y filtros del reporte", () => {
  it("un viaje CANCELADO no entra al reporte", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Can", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 1]]);
    const clienteId = await crearCliente(true);
    const { viajeIds } = await programa({
      plantelId, plantaId, clienteId, frecuencia: 15,
      viajes: [
        { llegada: h(10, 0), inicio: h(10, 5), fin: h(10, 25) },
        { llegada: h(11, 0), inicio: h(11, 5), fin: h(11, 40) },
      ],
    });
    await prisma.viajes.update({ where: { id: viajeIds[1] }, data: { estado: "Cancelado" } });

    const r = await correr([plantelId]);
    expect(r.detalle).toHaveLength(1);
    expect(r.detalle[0].viajeId).toBe(viajeIds[0]);
  });

  it("un pedido CANCELADO no entra al reporte", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM PC", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 1]]);
    const clienteId = await crearCliente(true);
    const { pedidoId } = await programa({
      plantelId, plantaId, clienteId, frecuencia: 15,
      viajes: [{ llegada: h(10, 0), inicio: h(10, 5), fin: h(10, 25) }],
    });
    await prisma.pedidos.update({ where: { id: pedidoId }, data: { estado_pedido: "Cancelado" } });

    expect((await correr([plantelId])).detalle).toHaveLength(0);
  });

  it("el filtro de cliente acota el detalle pero el selector sigue ofreciendo a todos", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Cli", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 2]]);
    const cA = await crearCliente(true);
    const cB = await crearCliente(true);
    await programa({ plantelId, plantaId, clienteId: cA, frecuencia: 15, viajes: [{ llegada: h(10, 0), inicio: h(10, 5), fin: h(10, 25) }] });
    await programa({ plantelId, plantaId, clienteId: cB, frecuencia: 15, viajes: [{ llegada: h(11, 0), inicio: h(11, 5), fin: h(11, 25) }] });

    const todos = await correr([plantelId]);
    expect(todos.detalle).toHaveLength(2);
    expect(todos.clientes).toHaveLength(2);

    const soloA = await correr([plantelId], cA);
    expect(soloA.detalle).toHaveLength(1);
    expect(soloA.detalle[0].clienteId).toBe(cA);
    // Si el selector se filtrara con el mismo where, al elegir un cliente
    // desaparecerian los demas y no se podria cambiar de filtro.
    expect(soloA.clientes).toHaveLength(2);
  });

  it("fuera del rango de fechas no entra nada", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Rango", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 1]]);
    const clienteId = await crearCliente(true);
    await programa({ plantelId, plantaId, clienteId, frecuencia: 15, viajes: [{ llegada: h(10, 0), inicio: h(10, 5), fin: h(10, 25) }] });

    const otroMes = await calcularDescargas({
      desde: new Date(2026, 9, 1),
      hasta: new Date(2026, 10, 1),
      plantelIds: [plantelId],
      clienteId: null,
      umbrales: U,
    });
    expect(otroMes.detalle).toHaveLength(0);
  });

  it("usa el volumen REAL cuando el despachador lo corrigió", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Vol", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 1]]);
    const clienteId = await crearCliente(true);
    const { viajeIds } = await programa({
      plantelId, plantaId, clienteId, frecuencia: 15,
      viajes: [{ llegada: h(10, 0), inicio: h(10, 5), fin: h(10, 25), vol: 11 }],
    });
    await prisma.viajes.update({ where: { id: viajeIds[0] }, data: { volumen_real_m3: 7.3 } });

    const r = await correr([plantelId]);
    expect(r.detalle[0].volumen).toBeCloseTo(7.3, 2);
  });
});

describe("cumplimiento del intervalo entre camiones", () => {
  it("mide la variabilidad real de las llegadas y marca el ritmo irregular", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Int", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 1]]);
    const clienteId = await crearCliente(true);
    // Huecos de 5, 25, 8 y 22 min: promedio 15, rango 20.
    await programa({
      plantelId, plantaId, clienteId, frecuencia: 15,
      viajes: [
        { llegada: h(8, 0), inicio: h(8, 5), fin: h(8, 20) },
        { llegada: h(8, 5), inicio: h(8, 20), fin: h(8, 35) },
        { llegada: h(8, 30), inicio: h(8, 35), fin: h(8, 50) },
        { llegada: h(8, 38), inicio: h(8, 50), fin: h(9, 5) },
        { llegada: h(9, 0), inicio: h(9, 5), fin: h(9, 20) },
      ],
    });

    const r = await correr([plantelId]);
    expect(r.intervalos).toHaveLength(1);
    const i = r.intervalos[0];
    expect(i.solicitadoMin).toBe(15);
    expect(i.realPromMin).toBe(15);
    expect(i.variabilidadMin).toBe(20);
    expect(i.irregular).toBe(true);
  });

  it("un pedido de UN solo viaje no aparece en la sección de intervalos", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Uno2", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 1]]);
    const clienteId = await crearCliente(true);
    await programa({ plantelId, plantaId, clienteId, frecuencia: 15, viajes: [{ llegada: h(8, 0), inicio: h(8, 5), fin: h(8, 20) }] });

    expect((await correr([plantelId])).intervalos).toHaveLength(0);
  });

  it("los viajes sin llegada registrada no cuentan para el intervalo", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM SinLl", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 1]]);
    const clienteId = await crearCliente(true);
    await programa({
      plantelId, plantaId, clienteId, frecuencia: 15,
      viajes: [
        { llegada: h(8, 0), inicio: h(8, 5), fin: h(8, 20) },
        { llegada: null, inicio: null, fin: null },
      ],
    });
    // Con una sola llegada no hay intervalo: no se inventa uno con el viaje sin dato.
    expect((await correr([plantelId])).intervalos).toHaveLength(0);
  });
});

describe("exportación a CSV", () => {
  it("trae las cuatro secciones y los mismos números que la pantalla", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Csv", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 1]]);
    const clienteId = await crearCliente(true);
    await prisma.clientes.update({ where: { id: clienteId }, data: { empresa: "Cliente CSV" } });
    await programa({
      plantelId, plantaId, clienteId, frecuencia: 15,
      viajes: [
        { llegada: h(10, 15), inicio: h(10, 47), fin: h(11, 9) }, // espera 32, real 22
        { llegada: h(11, 15), inicio: h(11, 20), fin: h(11, 32) }, // real 12
      ],
    });

    const r = await correr([plantelId]);
    const csv = descargasACsv(r, U, {
      desde: "2026-09-01", hasta: "2026-09-30", alcance: "Todos los planteles",
      cliente: "Todos los clientes", generadoPor: "test", generadoEn: "hoy",
    });

    expect(csv.startsWith("﻿sep=;")).toBe(true);
    for (const sec of ["COBERTURA DE DATOS", "RESUMEN DEL PERIODO", "RESUMEN POR CLIENTE", "CUMPLIMIENTO DEL INTERVALO", "DETALLE POR VIAJE"]) {
      expect(csv, sec).toContain(sec);
    }
    // Los números del CSV son los del cálculo, no una segunda derivación.
    expect(csv).toContain(`Minutos excedidos en total;${r.resumen.minutosExcedidos}`);
    expect(csv).toContain(`Horas-mixer en espera;${r.resumen.horasMixerEspera}`);
    expect(csv).toContain("Cliente CSV");
    // Una fila de detalle por viaje.
    const lineasDetalle = csv.split("\r\n").filter((l) => l.includes("MX-"));
    expect(lineasDetalle).toHaveLength(2);
  });

  it("el rango por defecto es del primer día del mes a hoy", () => {
    const r = rangoDeParams({}, new Date(2026, 8, 17, 14, 0));
    expect(r.desdeISO).toBe("2026-09-01");
    expect(r.hastaISO).toBe("2026-09-17");
  });
});
