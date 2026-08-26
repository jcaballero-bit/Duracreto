// Gantt de jornada vs. viajes contra Postgres.
//
// Lo que se prueba aquí es la ATRIBUCIÓN: qué viajes son de quién y con qué tramo del
// ciclo se mide cada puesto. Medir a todos con el ciclo completo sería falso — el
// dosificador solo está ocupado mientras carga y el operador de bomba mientras descarga.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { crearCliente, crearDiseno, crearPlantel, limpiarBD } from "./helpers";
import { datosGantt, leerUmbrales, personasParaGantt } from "@/lib/asistencia/gantt-datos";

// 2026-08-19, miércoles.
const DIA = new Date(2026, 7, 19);
const en = (h: number, m = 0) => new Date(2026, 7, 19, h, m, 0, 0);
const enDia20 = (h: number, m = 0) => new Date(2026, 7, 20, h, m, 0, 0);

async function crearPersona(
  nombre: string,
  puesto: string,
  plantelId: number | null,
  extra: { usuarioId?: string } = {},
) {
  const p = await prisma.operadores.create({
    data: {
      nombre,
      puesto,
      plantel_asignado_id: plantelId,
      usuario_id: extra.usuarioId ?? null,
    },
  });
  return p.id;
}

async function jornada(personaId: number, entrada: Date, salida: Date) {
  await prisma.asistencia_operativos.create({
    data: { persona_id: personaId, fecha: DIA, hora_entrada: entrada, hora_salida: salida },
  });
}

interface OpcionesViaje {
  plantelId: number;
  plantaId: number;
  clienteId: number;
  disenoId: number;
  operadorId?: number | null;
  mixerId?: number | null;
  bombaId?: number | null;
  /** Ciclo real: carga, fin de carga, descarga, fin de descarga, regreso. */
  carga: Date;
  finCarga: Date;
  inicioDescarga?: Date;
  finDescarga?: Date;
  regreso: Date;
  /** Si es false, no se sellan las horas reales (solo las programadas). */
  real?: boolean;
  volumen?: number;
}

async function crearViaje(o: OpcionesViaje) {
  const pedido = await prisma.pedidos.create({
    data: {
      cliente_id: o.clienteId,
      diseno_id: o.disenoId,
      volumen_total_m3: o.volumen ?? 9,
      volumen_programado: o.volumen ?? 9,
      hora_solicitada: o.carga,
      plantel_id: o.plantelId,
      planta_id: o.plantaId,
      tipo_descarga: o.bombaId ? "Bomba estacionaria" : "Canal directo",
      creado_por: "prueba",
      ...(o.bombaId ? { bombas: { create: [{ bomba_id: o.bombaId }] } } : {}),
    },
  });
  const real = o.real !== false;
  return prisma.viajes.create({
    data: {
      pedido_id: pedido.id,
      planta_id: o.plantaId,
      mixer_id: o.mixerId ?? null,
      operador_id: o.operadorId ?? null,
      capacidad_asignada_m3: 11,
      volumen_asignado_m3: o.volumen ?? 9,
      hora_solicitada: o.carga,
      // Programadas siempre (son la línea base del programa).
      hora_inicio_carga: o.carga,
      hora_fin_carga: o.finCarga,
      hora_inicio_descarga: o.inicioDescarga ?? null,
      hora_fin_descarga: o.finDescarga ?? null,
      hora_regreso_planta: o.regreso,
      // Reales solo si el viaje se despachó de verdad.
      ts_inicio_carga_real: real ? o.carga : null,
      ts_fin_carga_real: real ? o.finCarga : null,
      ts_inicio_descarga_real: real ? o.inicioDescarga ?? null : null,
      ts_fin_descarga_real: real ? o.finDescarga ?? null : null,
      ts_regreso_real: real ? o.regreso : null,
      estado: "Completado",
    },
  });
}

async function gantt(plantelIds: number[] | null = null) {
  return datosGantt(DIA, await personasParaGantt(plantelIds), await leerUmbrales());
}

beforeEach(async () => {
  await limpiarBD();
  await prisma.bitacora_auditoria.deleteMany();
  await prisma.operadores.deleteMany();
  await prisma.user.deleteMany();
});

describe("motorista: el ciclo completo de sus viajes", () => {
  it("jornada 05:45-19:02 con 4 viajes: con viaje + sin viaje = jornada", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Gantt", zona: "Norte", esHub: true });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const mixer = await prisma.mixers.create({
      data: { marca: "T", capacidad_m3: 12, plantel_base_id: plantelId, identificador: "M-01" },
    });
    const personaId = await crearPersona("Motorista Uno", "Motorista_Mixer", plantelId);
    await jornada(personaId, en(5, 45), en(19, 2));

    const base = { plantelId, plantaId, clienteId, disenoId, operadorId: personaId, mixerId: mixer.id };
    await crearViaje({ ...base, carga: en(6, 10), finCarga: en(6, 30), inicioDescarga: en(7), finDescarga: en(7, 20), regreso: en(7, 40) });
    await crearViaje({ ...base, carga: en(8), finCarga: en(8, 20), inicioDescarga: en(8, 50), finDescarga: en(9, 10), regreso: en(9, 30) });
    await crearViaje({ ...base, carga: en(9, 50), finCarga: en(10, 10), inicioDescarga: en(10, 40), finDescarga: en(11), regreso: en(11, 20) });
    // Hueco real de 4 h 20 min hasta el último viaje.
    await crearViaje({ ...base, carga: en(15, 40), finCarga: en(16), inicioDescarga: en(16, 30), finDescarga: en(16, 50), regreso: en(17, 10) });

    const d = await gantt([plantelId]);
    const f = d.filas.find((x) => x.personaId === personaId)!;
    expect(f.mide).toBe(true);
    expect(f.resumen.minutosJornada).toBe(797);
    expect(f.resumen.minutosProductivos).toBe(360); // 4 ciclos de 90 min
    expect(f.resumen.minutosSinViaje).toBe(437);
    expect(f.resumen.minutosProductivos + f.resumen.minutosSinViaje).toBe(f.resumen.minutosJornada);
    // El hueco grande se dibuja y sabe entre qué viajes quedó.
    const grande = f.resumen.huecos.find((h) => h.minutos === 260)!;
    expect(grande.marcado).toBe(true);
    expect(grande.viajeAntes).not.toBeNull();
    expect(grande.viajeDespues).not.toBeNull();
    // Y el detalle del viaje trae lo que se muestra al hacer clic.
    expect(f.viajes[0].cliente).toBe("Cliente Test");
    expect(f.viajes[0].mixer).toBe("M-01");
    expect(f.unidad).toBe("M-01");
  });

  it("solo se le atribuyen los viajes donde va como motorista", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Otro", zona: "Norte", esHub: true });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const yo = await crearPersona("Yo", "Motorista_Mixer", plantelId);
    const otro = await crearPersona("Otro motorista", "Motorista_Mixer", plantelId);
    await jornada(yo, en(7), en(15));
    await jornada(otro, en(7), en(15));

    const base = { plantelId, plantaId, clienteId, disenoId };
    await crearViaje({ ...base, operadorId: yo, carga: en(8), finCarga: en(8, 20), regreso: en(9, 30) });
    await crearViaje({ ...base, operadorId: otro, carga: en(10), finCarga: en(10, 20), regreso: en(11, 30) });

    const d = await gantt([plantelId]);
    const mio = d.filas.find((x) => x.personaId === yo)!;
    expect(mio.viajes).toHaveLength(1);
    expect(mio.resumen.minutosProductivos).toBe(90);
  });

  it("un viaje sin horas reales se marca como estimado", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Est", zona: "Norte", esHub: true });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const personaId = await crearPersona("Motorista", "Motorista_Mixer", plantelId);
    await jornada(personaId, en(7), en(15));
    await crearViaje({
      plantelId, plantaId, clienteId, disenoId, operadorId: personaId,
      carga: en(8), finCarga: en(8, 20), regreso: en(9, 30), real: false,
    });

    const d = await gantt([plantelId]);
    const f = d.filas.find((x) => x.personaId === personaId)!;
    expect(f.resumen.tramos).toHaveLength(1);
    expect(f.resumen.tramos[0].estimado).toBe(true);
    expect(f.viajes[0].estimado).toBe(true);
  });

  it("un viaje que arranca antes de la entrada marcada se reporta fuera de la jornada", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Fuera", zona: "Norte", esHub: true });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const personaId = await crearPersona("Motorista", "Motorista_Mixer", plantelId);
    await jornada(personaId, en(7), en(15));
    // Cargó a las 06:00, una hora antes de la marca del reloj.
    await crearViaje({
      plantelId, plantaId, clienteId, disenoId, operadorId: personaId,
      carga: en(6), finCarga: en(6, 20), regreso: en(7, 30),
    });

    const d = await gantt([plantelId]);
    const f = d.filas.find((x) => x.personaId === personaId)!;
    expect(f.resumen.fueraDeJornada).toHaveLength(1);
    expect(f.resumen.minutosProductivos).toBe(30); // solo 07:00-07:30 cae dentro
  });
});

describe("dosificador: el tiempo de carga de SU planta", () => {
  it("suma las cargas de su planta, no los ciclos completos", async () => {
    // Plantel con UNA planta: no hay ambigüedad, así que se resuelve sin vínculo.
    const { plantelId, plantaId } = await crearPlantel({ nombre: "CHO Gantt", zona: "Norte", esHub: true });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const dosi = await crearPersona("Dosificador Uno", "Dosificador", plantelId);
    const moto = await crearPersona("Motorista Uno", "Motorista_Mixer", plantelId);
    await jornada(dosi, en(6), en(15));
    await jornada(moto, en(6), en(15));

    const base = { plantelId, plantaId, clienteId, disenoId, operadorId: moto };
    // Dos viajes: cargas de 20 min cada una, ciclos de 90 min cada uno.
    await crearViaje({ ...base, carga: en(7), finCarga: en(7, 20), regreso: en(8, 30) });
    await crearViaje({ ...base, carga: en(9), finCarga: en(9, 20), regreso: en(10, 30) });

    const d = await gantt([plantelId]);
    const fd = d.filas.find((x) => x.personaId === dosi)!;
    const fm = d.filas.find((x) => x.personaId === moto)!;

    expect(fd.mide).toBe(true);
    expect(fd.resumen.minutosProductivos).toBe(40); // 2 cargas x 20 min
    expect(fm.resumen.minutosProductivos).toBe(180); // 2 ciclos x 90 min
    // Misma jornada, distinto tiempo productivo: por eso los % no se comparan entre puestos.
    expect(fd.resumen.minutosJornada).toBe(fm.resumen.minutosJornada);
    expect(fd.resumen.pctSinViaje).toBeGreaterThan(fm.resumen.pctSinViaje);
    // Y su escala de semáforo es la del dosificador, más alta.
    expect(fd.umbrales.verde_pct).toBe(50);
    expect(fm.umbrales.verde_pct).toBe(20);
  });

  it("solo cuentan las cargas dentro de su jornada (el otro turno es de otra persona)", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "CHO Turno", zona: "Norte", esHub: true });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const dosi = await crearPersona("Dosificador manana", "Dosificador", plantelId);
    await jornada(dosi, en(6), en(14));

    const base = { plantelId, plantaId, clienteId, disenoId };
    await crearViaje({ ...base, carga: en(7), finCarga: en(7, 20), regreso: en(8, 30) });
    // Carga de las 16:00: turno del dosificador de la tarde.
    await crearViaje({ ...base, carga: en(16), finCarga: en(16, 20), regreso: en(17, 30) });

    const d = await gantt([plantelId]);
    const f = d.filas.find((x) => x.personaId === dosi)!;
    expect(f.viajes).toHaveLength(1);
    expect(f.resumen.minutosProductivos).toBe(20);
    // No se marca como anomalía: es el turno de alguien más, no una marca mal puesta.
    expect(f.resumen.fueraDeJornada).toHaveLength(0);
  });

  it("con dos plantas y sin usuario vinculado, lo dice en vez de adivinar", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM DosPlantas", zona: "Norte", esHub: true });
    await prisma.plantas.create({ data: { plantel_id: plantelId, nombre: "SANY", capacidad_m3h: 50 } });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const dosi = await crearPersona("Dosificador sin vinculo", "Dosificador", plantelId);
    await jornada(dosi, en(6), en(15));
    await crearViaje({ plantelId, plantaId, clienteId, disenoId, carga: en(7), finCarga: en(7, 20), regreso: en(8, 30) });

    const d = await gantt([plantelId]);
    const f = d.filas.find((x) => x.personaId === dosi)!;
    expect(f.mide).toBe(false);
    expect(f.motivoNoMide).toContain("varias plantas");
    expect(f.resumen.minutosSinViaje).toBe(0); // no se inventa un porcentaje
  });

  it("con usuario vinculado usa la planta del día (incluida la reasignación)", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Vinculo", zona: "Norte", esHub: true });
    const sany = await prisma.plantas.create({
      data: { plantel_id: plantelId, nombre: "SANY", capacidad_m3h: 50 },
    });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const usuario = await prisma.user.create({
      data: { name: "Dosi Usuario", email: "dosi@test.com", planta_predeterminada_id: plantaId },
    });
    const dosi = await crearPersona("Dosificador vinculado", "Dosificador", plantelId, {
      usuarioId: usuario.id,
    });
    await jornada(dosi, en(6), en(15));

    // Una carga en cada planta.
    await crearViaje({ plantelId, plantaId, clienteId, disenoId, carga: en(7), finCarga: en(7, 20), regreso: en(8, 30) });
    await crearViaje({ plantelId, plantaId: sany.id, clienteId, disenoId, carga: en(9), finCarga: en(9, 40), regreso: en(10, 30) });

    // Su planta predeterminada: solo la carga de 20 min.
    let d = await gantt([plantelId]);
    let f = d.filas.find((x) => x.personaId === dosi)!;
    expect(f.resumen.minutosProductivos).toBe(20);

    // Reasignado a SANY ese día: ahora le corresponde la carga de 40 min.
    await prisma.reasignaciones_dosificador_planta.create({
      data: { dosificador_id: usuario.id, planta_id: sany.id, fecha: DIA, creado_por: "prueba" },
    });
    d = await gantt([plantelId]);
    f = d.filas.find((x) => x.personaId === dosi)!;
    expect(f.resumen.minutosProductivos).toBe(40);
  });
});

describe("operador de bomba: el tiempo de descarga de SU bomba", () => {
  it("suma las descargas de los viajes que usaron su bomba", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Bomba", zona: "Norte", esHub: true });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const opb = await crearPersona("Operador bomba", "Operador_Bomba", plantelId);
    const suya = await prisma.bombas.create({
      data: {
        identificador: "SM-B1",
        plantel_base_id: plantelId,
        operadores: { create: [{ operador_id: opb }] },
      },
    });
    const ajena = await prisma.bombas.create({
      data: { identificador: "SM-B2", plantel_base_id: plantelId },
    });
    await jornada(opb, en(6), en(15));

    const base = { plantelId, plantaId, clienteId, disenoId };
    // Con su bomba: descargas de 60 y 30 min.
    await crearViaje({ ...base, bombaId: suya.id, carga: en(7), finCarga: en(7, 20), inicioDescarga: en(8), finDescarga: en(9), regreso: en(9, 30) });
    await crearViaje({ ...base, bombaId: suya.id, carga: en(10), finCarga: en(10, 20), inicioDescarga: en(11), finDescarga: en(11, 30), regreso: en(12) });
    // Con la otra bomba: no es suyo.
    await crearViaje({ ...base, bombaId: ajena.id, carga: en(12, 30), finCarga: en(12, 50), inicioDescarga: en(13), finDescarga: en(14), regreso: en(14, 30) });

    const d = await gantt([plantelId]);
    const f = d.filas.find((x) => x.personaId === opb)!;
    expect(f.mide).toBe(true);
    expect(f.viajes).toHaveLength(2);
    expect(f.resumen.minutosProductivos).toBe(90); // 60 + 30 de descarga
    expect(f.unidad).toBe("SM-B1");
  });

  it("dos operadores se relevan en la MISMA bomba: a cada uno sus descargas por jornada", async () => {
    // El turno no se captura aparte: sale de la jornada de cada uno.
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Relevo", zona: "Norte", esHub: true });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const manana = await crearPersona("Operador manana", "Operador_Bomba", plantelId);
    const tarde = await crearPersona("Operador tarde", "Operador_Bomba", plantelId);
    const bomba = await prisma.bombas.create({
      data: {
        identificador: "SM-B1",
        plantel_base_id: plantelId,
        operadores: { create: [{ operador_id: manana }, { operador_id: tarde }] },
      },
    });
    await jornada(manana, en(6), en(14));
    await jornada(tarde, en(14), en(22));

    const base = { plantelId, plantaId, clienteId, disenoId, bombaId: bomba.id };
    // Descarga de 60 min en el turno de la manana y otra de 45 en el de la tarde.
    await crearViaje({ ...base, carga: en(8), finCarga: en(8, 20), inicioDescarga: en(9), finDescarga: en(10), regreso: en(10, 30) });
    await crearViaje({ ...base, carga: en(15), finCarga: en(15, 20), inicioDescarga: en(16), finDescarga: en(16, 45), regreso: en(17, 15) });

    const d = await gantt([plantelId]);
    const fm = d.filas.find((x) => x.personaId === manana)!;
    const ft = d.filas.find((x) => x.personaId === tarde)!;
    expect(fm.viajes).toHaveLength(1);
    expect(fm.resumen.minutosProductivos).toBe(60);
    expect(ft.viajes).toHaveLength(1);
    expect(ft.resumen.minutosProductivos).toBe(45);
    // Ninguna descarga quedo huerfana ni compartida.
    expect(d.resumen.descargasSinOperador).toBe(0);
    expect(fm.descargasCompartidas).toBe(0);
    expect(ft.descargasCompartidas).toBe(0);
  });

  it("si las jornadas del relevo se traslapan, la descarga se cuenta a los dos y se avisa", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Traslape", zona: "Norte", esHub: true });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const uno = await crearPersona("Operador uno", "Operador_Bomba", plantelId);
    const dos = await crearPersona("Operador dos", "Operador_Bomba", plantelId);
    const bomba = await prisma.bombas.create({
      data: {
        identificador: "SM-B9",
        plantel_base_id: plantelId,
        operadores: { create: [{ operador_id: uno }, { operador_id: dos }] },
      },
    });
    // Jornadas traslapadas de 13:00 a 15:00.
    await jornada(uno, en(6), en(15));
    await jornada(dos, en(13), en(21));
    await crearViaje({
      plantelId, plantaId, clienteId, disenoId, bombaId: bomba.id,
      carga: en(13), finCarga: en(13, 20), inicioDescarga: en(14), finDescarga: en(14, 30), regreso: en(15),
    });

    const d = await gantt([plantelId]);
    const f1 = d.filas.find((x) => x.personaId === uno)!;
    const f2 = d.filas.find((x) => x.personaId === dos)!;
    expect(f1.resumen.minutosProductivos).toBe(30);
    expect(f2.resumen.minutosProductivos).toBe(30);
    // Los dos estaban en turno: se cuenta para ambos, pero queda avisado.
    expect(f1.descargasCompartidas).toBe(1);
    expect(f2.descargasCompartidas).toBe(1);
  });

  it("una descarga fuera de la jornada de TODOS sus operadores se reporta", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Huerfana", zona: "Norte", esHub: true });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const opb = await crearPersona("Operador manana", "Operador_Bomba", plantelId);
    const bomba = await prisma.bombas.create({
      data: {
        identificador: "SM-B3",
        plantel_base_id: plantelId,
        operadores: { create: [{ operador_id: opb }] },
      },
    });
    await jornada(opb, en(6), en(14));
    // Descarga de las 18:00: nadie de esa bomba tenia jornada a esa hora.
    await crearViaje({
      plantelId, plantaId, clienteId, disenoId, bombaId: bomba.id,
      carga: en(17), finCarga: en(17, 20), inicioDescarga: en(18), finDescarga: en(18, 40), regreso: en(19),
    });

    const d = await gantt([plantelId]);
    const f = d.filas.find((x) => x.personaId === opb)!;
    expect(f.viajes).toHaveLength(0);
    expect(d.resumen.descargasSinOperador).toBe(1);
  });

  it("sin bomba asignada lo dice en vez de mostrar 100 % sin viaje", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM SinBomba", zona: "Norte", esHub: true });
    const opb = await crearPersona("Operador sin bomba", "Operador_Bomba", plantelId);
    await jornada(opb, en(6), en(15));

    const d = await gantt([plantelId]);
    const f = d.filas.find((x) => x.personaId === opb)!;
    expect(f.mide).toBe(false);
    expect(f.motivoNoMide).toContain("no tiene bomba asignada");
  });
});

describe("puestos sin medición por viaje", () => {
  it("el operador de cargadora muestra solo su jornada, sin porcentaje", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Carga", zona: "Norte", esHub: true });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const cargadora = await crearPersona("Operador cargadora", "Operador_Cargadora", plantelId);
    await jornada(cargadora, en(6), en(15));
    await crearViaje({ plantelId, plantaId, clienteId, disenoId, carga: en(7), finCarga: en(7, 20), regreso: en(8, 30) });

    const d = await gantt([plantelId]);
    const f = d.filas.find((x) => x.personaId === cargadora)!;
    expect(f.mide).toBe(false);
    expect(f.motivoNoMide).toBe("sin medición por viaje");
    expect(f.resumen.tramos).toHaveLength(0);
    expect(f.resumen.minutosSinViaje).toBe(0);
    expect(f.resumen.pctSinViaje).toBe(0);
    // Su jornada SÍ se dibuja.
    expect(f.jornadaInicioMs).not.toBeNull();
    // Y no entra en el resumen de personas medidas.
    expect(d.resumen.personasMedidas).toBe(0);
  });
});

describe("datos faltantes y turno nocturno", () => {
  it("con viajes pero sin jornada capturada, se avisa (no es un cero)", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM SinJor", zona: "Norte", esHub: true });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const personaId = await crearPersona("Motorista sin marca", "Motorista_Mixer", plantelId);
    await crearViaje({
      plantelId, plantaId, clienteId, disenoId, operadorId: personaId,
      carga: en(8), finCarga: en(8, 20), regreso: en(9, 30),
    });

    const d = await gantt([plantelId]);
    const f = d.filas.find((x) => x.personaId === personaId)!;
    expect(f.faltaJornada).toBe(true);
    expect(f.jornadaTexto).toBe("sin jornada registrada");
    expect(f.resumen.tramos).toHaveLength(1); // sus viajes se ven igual
    expect(f.resumen.minutosJornada).toBe(0);
    expect(d.resumen.personasSinJornada).toBe(1);
  });

  it("una ausencia se muestra como tal, sin tiempo sin viaje", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM Aus", zona: "Norte", esHub: true });
    const personaId = await crearPersona("De vacaciones", "Motorista_Mixer", plantelId);
    await prisma.asistencia_operativos.create({
      data: { persona_id: personaId, fecha: DIA, tipo_ausencia: "Vacaciones" },
    });

    const d = await gantt([plantelId]);
    const f = d.filas.find((x) => x.personaId === personaId)!;
    expect(f.ausencia).toBe("Vacaciones");
    expect(f.faltaJornada).toBe(false); // no falta el dato: se sabe que no vino
    expect(f.resumen.minutosSinViaje).toBe(0);
  });

  it("un turno que cruza la medianoche se dibuja hacia adelante", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Noche", zona: "Norte", esHub: true });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const personaId = await crearPersona("Motorista noche", "Motorista_Mixer", plantelId);
    await jornada(personaId, en(18), enDia20(2));
    await crearViaje({
      plantelId, plantaId, clienteId, disenoId, operadorId: personaId,
      carga: en(23), finCarga: en(23, 20), regreso: enDia20(0, 30),
    });

    const d = await gantt([plantelId]);
    const f = d.filas.find((x) => x.personaId === personaId)!;
    expect(f.cruzaMedianoche).toBe(true);
    expect(f.resumen.minutosJornada).toBe(480);
    expect(f.resumen.minutosProductivos).toBe(90);
    expect(f.jornadaFinMs!).toBeGreaterThan(f.jornadaInicioMs!);
    for (const t of f.resumen.tramos) expect(t.finMs).toBeGreaterThan(t.inicioMs);
    // El eje llega hasta después de la medianoche.
    expect(d.ejeHastaMs!).toBeGreaterThan(enDia20(2).getTime() - 1);
  });
});

describe("alcance por rol", () => {
  it("un Jefe de Planta solo ve el personal de sus planteles", async () => {
    const suyo = await crearPlantel({ nombre: "CHO Jefe", zona: "Norte", esHub: true });
    const ajeno = await crearPlantel({ nombre: "SM Jefe", zona: "Norte", hubId: suyo.plantelId });
    const mio = await crearPersona("De Choloma", "Motorista_Mixer", suyo.plantelId);
    const otro = await crearPersona("De Santa Marta", "Motorista_Mixer", ajeno.plantelId);
    await jornada(mio, en(7), en(15));
    await jornada(otro, en(7), en(15));

    const soloSuyo = await gantt([suyo.plantelId]);
    expect(soloSuyo.filas.map((f) => f.personaId)).toEqual([mio]);

    // El Administrador (null = todos) ve a los dos.
    const todo = await gantt(null);
    expect(todo.filas.map((f) => f.personaId).sort()).toEqual([mio, otro].sort());
  });

  it("el resumen del plantel suma solo a quien se puede medir", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Resumen", zona: "Norte", esHub: true });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const moto = await crearPersona("Motorista", "Motorista_Mixer", plantelId);
    const cargadora = await crearPersona("Cargadora", "Operador_Cargadora", plantelId);
    await jornada(moto, en(7), en(15)); // 8 h
    await jornada(cargadora, en(7), en(15)); // 8 h, pero sin medición
    await crearViaje({
      plantelId, plantaId, clienteId, disenoId, operadorId: moto,
      carga: en(8), finCarga: en(8, 20), regreso: en(9, 30),
    });

    const d = await gantt([plantelId]);
    expect(d.resumen.personasMedidas).toBe(1);
    expect(d.resumen.horasJornada).toBe(8); // solo la del motorista
    expect(d.resumen.horasProductivas).toBe(1.5);
    expect(d.resumen.horasSinViaje).toBe(6.5);
    expect(d.resumen.horasProductivas + d.resumen.horasSinViaje).toBe(d.resumen.horasJornada);
  });
});
