// Pruebas de INTEGRACIÓN del motor contra la BD de prueba (test.db).
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  agregarVolumenAlPedido,
  analizarFrecuenciaPedido,
  avanzarEstadoViaje,
  cambiarPlantaViaje,
  cancelarPedido,
  cancelarPedidoConMotivo,
  confirmarRefuerzo,
  corregirHoraReal,
  detectarAlertasMargen,
  editarVolumenViaje,
  modificarPedido,
  programarPedido,
  reasignarMixer,
  recalcularCascadaPlanta,
  recalcularTransportePromedioCliente,
  reordenarPedidoDia,
  sugerirHoraDisponible,
} from "@/lib/motor/asignacion";
import { calcularAlcance, filtroPedidoPorZona } from "@/lib/auth/acceso";
import { PERMITIR_HORA_CARGA_MANUAL } from "@/lib/motor/config";
import { calcularDesempeno } from "@/lib/comercial/metricas";
import {
  crearCliente,
  crearDiseno,
  crearMixers,
  crearPlantel,
  limpiarBD,
} from "./helpers";

// Día futuro fijo para que ningún viaje se considere "pasado/fijo".
const DIA = new Date("2026-08-01T08:00:00");

beforeEach(async () => {
  await limpiarBD();
});

describe("Fase 3 — filtro de pedidos por zona (server-side)", () => {
  it("un Programador de Norte solo ve pedidos de su zona", async () => {
    const norte = await crearPlantel({ nombre: "N-Hub", zona: "Norte", esHub: true });
    await crearMixers(norte.plantelId, [[11, 2]]);
    const centro = await crearPlantel({
      nombre: "CS-Hub",
      zona: "Centro Sur",
      esHub: true,
    });
    await crearMixers(centro.plantelId, [[11, 2]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const base = {
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 10,
      hora_solicitada: DIA,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    };
    await programarPedido({ ...base, plantel_id: norte.plantelId, planta_id: norte.plantaId });
    await programarPedido({ ...base, plantel_id: centro.plantelId, planta_id: centro.plantaId });

    const alcance = calcularAlcance(["Programador"], "Norte");
    const pedidos = await prisma.pedidos.findMany({
      where: filtroPedidoPorZona(alcance),
      include: { plantel: true },
    });
    expect(pedidos.length).toBe(1);
    expect(pedidos.every((p) => p.plantel.zona === "Norte")).toBe(true);

    // El Administrador ve ambos.
    const admin = calcularAlcance(["Administrador"], null);
    const todos = await prisma.pedidos.findMany({ where: filtroPedidoPorZona(admin) });
    expect(todos.length).toBe(2);
  });
});

describe("programarPedido — reglas de capacidad", () => {
  it("pedido que cabe exacto en capacidades completas (flota propia)", async () => {
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "Hub Norte",
      zona: "Norte",
      esHub: true,
    });
    await crearMixers(plantelId, [[11, 5]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 22,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Directo",
      creado_por: "test",
    });

    expect(r.volumenSinCubrir).toBe(0);
    const conMixer = r.viajes.filter((v) => v.mixerId != null);
    expect(conMixer).toHaveLength(2);
    expect(conMixer.every((v) => v.volumen === 11)).toBe(true);
    expect(conMixer.every((v) => v.origen === "Flota propia")).toBe(true);
  });

  it("elige la combinación de menor sobrante (25 m³ → 9+9+7 exacto, sin carga parcial)", async () => {
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "Hub Mixto",
      zona: "Norte",
      esHub: true,
    });
    await crearMixers(plantelId, [
      [11, 2],
      [9, 2],
      [7, 2],
    ]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 25,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Directo",
      creado_por: "test",
    });

    expect(r.volumenSinCubrir).toBe(0);
    const conMixer = r.viajes.filter((v) => v.mixerId != null);
    expect(conMixer).toHaveLength(3);
    // 9 + 9 + 7 = 25 EXACTO: ningún viaje parcial, y sin usar el mixer de 11.
    expect(conMixer.map((v) => v.capacidad).sort()).toEqual([7, 9, 9]);
    expect(conMixer.every((v) => v.volumen === v.capacidad)).toBe(true);
  });

  it("16 m³ con 9 y 7 → 1×9 + 1×7 (mixers reales asignados, 0 sin cubrir)", async () => {
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "Hub 9y7",
      zona: "Norte",
      esHub: true,
    });
    await crearMixers(plantelId, [
      [9, 2],
      [7, 2],
    ]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 16,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Directo",
      creado_por: "test",
    });

    expect(r.volumenSinCubrir).toBe(0);
    const conMixer = r.viajes.filter((v) => v.mixerId != null);
    expect(conMixer).toHaveLength(2);
    expect(conMixer.map((v) => v.capacidad).sort()).toEqual([7, 9]);
  });
});

describe("programarPedido — préstamo de zona (Paso 2)", () => {
  it("un pedido en Choloma (sin flota) se cubre con préstamo de Santa Marta", async () => {
    const santaMarta = await crearPlantel({
      nombre: "Santa Marta",
      zona: "Norte",
      esHub: true,
    });
    await crearMixers(santaMarta.plantelId, [[11, 4]]);
    const choloma = await crearPlantel({
      nombre: "Choloma",
      zona: "Norte",
      hubId: santaMarta.plantelId,
      capacidadPlantaM3h: 28,
    });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 20,
      hora_solicitada: DIA,
      plantel_id: choloma.plantelId,
      planta_id: choloma.plantaId,
      tipo_descarga: "Directo",
      creado_por: "test",
    });

    expect(r.volumenSinCubrir).toBe(0);
    const conMixer = r.viajes.filter((v) => v.mixerId != null);
    expect(conMixer.length).toBeGreaterThan(0);
    expect(conMixer.every((v) => v.origen === "Préstamo de zona")).toBe(true);
    // Los mixers prestados son físicamente de Santa Marta.
    for (const v of conMixer) {
      const m = await prisma.mixers.findUnique({ where: { id: v.mixerId! } });
      expect(m?.plantel_base_id).toBe(santaMarta.plantelId);
    }
  });
});

describe("reutilización de mixers por horario (Punto 1)", () => {
  it("un pedido que necesita MÁS viajes que mixers distintos reutiliza el mismo mixer (escalonado), sin 'flota insuficiente'", async () => {
    // UN solo mixer de 11. Pedido de 30 m³ → 3 viajes de 11 (11+11+parcial 8),
    // todos en ese único mixer, escalonados por su tiempo real de ciclo.
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "Un Solo Mixer",
      zona: "Norte",
      esHub: true,
      capacidadPlantaM3h: 45,
    });
    await crearMixers(plantelId, [[11, 1]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 30,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Directo",
      creado_por: "test",
    });

    // TODO el volumen se cubre reutilizando el único mixer.
    expect(r.volumenSinCubrir).toBe(0);
    const conMixer = r.viajes.filter((v) => v.mixerId != null);
    expect(conMixer).toHaveLength(3);
    // Todos los viajes usan el MISMO mixer (solo hay uno).
    const distintos = new Set(conMixer.map((v) => v.mixerId));
    expect(distintos.size).toBe(1);

    // Los ciclos NO se traslapan: cada viaje arranca cuando el anterior regresó.
    const viajes = await prisma.viajes.findMany({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
      orderBy: { hora_inicio_carga: "asc" },
    });
    for (let i = 1; i < viajes.length; i++) {
      expect(viajes[i].hora_inicio_carga!.getTime()).toBeGreaterThanOrEqual(
        viajes[i - 1].hora_regreso_planta!.getTime(),
      );
    }
  });

  it("reparto de desgaste: a igual disponibilidad elige el mixer que lleva más tiempo sin viaje", async () => {
    // Dos mixers de 11. El primer pedido usa uno; un segundo pedido MÁS TARDE
    // (cuando ambos ya están libres) debe tomar el que NO se usó antes.
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "Desgaste",
      zona: "Norte",
      esHub: true,
      capacidadPlantaM3h: 45,
    });
    await crearMixers(plantelId, [[11, 2]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const r1 = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 10,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Directo",
      creado_por: "test",
    });
    const mixer1 = r1.viajes.find((v) => v.mixerId != null)!.mixerId!;

    // Segundo pedido varias horas después (ambos mixers ya regresaron).
    const masTarde = new Date("2026-08-01T15:00:00");
    const r2 = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 10,
      hora_solicitada: masTarde,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Directo",
      creado_por: "test",
    });
    const mixer2 = r2.viajes.find((v) => v.mixerId != null)!.mixerId!;

    // El segundo pedido usa el OTRO mixer (el más ocioso), no el ya usado.
    expect(mixer2).not.toBe(mixer1);
  });
});

describe("traslape de mixer — nunca doble reserva", () => {
  it("dos pedidos a la misma hora con UN mixer se serializan en ese mixer (sin traslape, sin sin-cubrir)", async () => {
    // Plantel con UN solo mixer. Dos pedidos a la misma hora en la misma planta:
    // el segundo reutiliza el mixer más tarde (cuando regresa), no queda sin cubrir.
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "Un Mixer",
      zona: "Norte",
      esHub: true,
    });
    await crearMixers(plantelId, [[11, 1]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const base = {
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 10,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Directo",
      creado_por: "test",
    };

    const r1 = await programarPedido(base);
    expect(r1.volumenSinCubrir).toBe(0);
    const mixer1 = r1.viajes.find((v) => v.mixerId != null)!.mixerId!;

    // Segundo pedido a la misma hora: reutiliza el mismo mixer, escalonado.
    const r2 = await programarPedido(base);
    expect(r2.volumenSinCubrir).toBe(0);
    const viaje2 = r2.viajes.find((v) => v.mixerId != null)!;
    expect(viaje2.mixerId).toBe(mixer1); // el único mixer, reutilizado
    // Arranca cuando el primer viaje ya regresó (ciclos sin traslape).
    const viaje1 = await prisma.viajes.findFirstOrThrow({
      where: { pedido_id: r1.pedidoId, mixer_id: { not: null } },
    });
    expect(viaje2.hora_inicio_carga!.getTime()).toBeGreaterThanOrEqual(
      viaje1.hora_regreso_planta!.getTime(),
    );
  });

  it("reasignarMixer libera el viaje en conflicto y lo reprograma con otro mixer", async () => {
    // Plantel con dos mixers → dos pedidos quedan cubiertos con mixers distintos.
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "Dos Mixers",
      zona: "Norte",
      esHub: true,
    });
    await crearMixers(plantelId, [[11, 2]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const base = {
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 10,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Directo",
      creado_por: "test",
    };

    const r1 = await programarPedido(base); // pedido 1 (orden de atención 1)
    const r2 = await programarPedido(base); // pedido 2 (orden de atención 2, "más adelante")
    const viaje1 = r1.viajes.find((v) => v.mixerId != null)!;
    const mixerDe2 = r2.viajes.find((v) => v.mixerId != null)!.mixerId!;
    expect(viaje1.mixerId).not.toBe(mixerDe2);

    // Mover el viaje del pedido 1 al mixer del pedido 2 (que lo tiene MÁS ADELANTE
    // y se traslapa): en vez de rechazar, LIBERA el viaje futuro (pedido 2) y lo
    // reprograma con el otro mixer.
    const res = await reasignarMixer(viaje1.id, mixerDe2);
    expect(res.ok).toBe(true);
    expect(res.volumenSinCubrir).toBe(0);

    const v1 = await prisma.viajes.findUniqueOrThrow({ where: { id: viaje1.id } });
    expect(v1.mixer_id).toBe(mixerDe2); // el objetivo quedó con el mixer pedido
    const v2 = await prisma.viajes.findFirstOrThrow({
      where: { pedido_id: r2.pedidoId, mixer_id: { not: null } },
    });
    expect(v2.mixer_id).not.toBe(mixerDe2); // el viaje futuro liberado tomó el otro mixer
  });

  it("reasignarMixer a un mixer más pequeño recalcula el volumen (viaje adicional)", async () => {
    // Plantel con un mixer de 9 y dos de 7.
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "Cap Mix",
      zona: "Norte",
      esHub: true,
    });
    await crearMixers(plantelId, [[9, 1], [7, 2]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const base = {
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 9,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Directo",
      creado_por: "test",
    };

    // 9 m³ → un solo viaje de 9 en el mixer de 9.
    const r = await programarPedido(base);
    expect(r.volumenSinCubrir).toBe(0);
    const trip = r.viajes.find((v) => v.mixerId != null)!;
    // El de menor capacidad fisica (carga usable 7) del plantel.
    const mixer7 = await prisma.mixers.findFirstOrThrow({
      where: { plantel_base_id: plantelId },
      orderBy: { capacidad_m3: "asc" },
    });

    // Reasignar a un mixer de 7: el volumen se recorta a 7 y los 2 m³ restantes se
    // cubren con un viaje adicional (mejor combinación de capacidades).
    const res = await reasignarMixer(trip.id, mixer7.id);
    expect(res.ok).toBe(true);
    expect(res.volumenSinCubrir).toBe(0);

    const viajes = await prisma.viajes.findMany({
      where: { pedido_id: r.pedidoId, estado: { not: "Cancelado" }, mixer_id: { not: null } },
    });
    const totalVol = viajes.reduce((s, v) => s + v.volumen_asignado_m3, 0);
    expect(Math.round(totalVol * 100) / 100).toBe(9);
    expect(viajes.length).toBe(2);
    const objetivo = viajes.find((v) => v.id === trip.id)!;
    expect(objetivo.mixer_id).toBe(mixer7.id);
    expect(objetivo.volumen_asignado_m3).toBe(7);
  });

  it("permite tomar un mixer cuyo viaje traslapado YA se completó (por horas reales)", async () => {
    // Dos mixers -> dos pedidos con mixers distintos. El viaje A se COMPLETA con
    // horas reales que terminan antes de que el viaje B cargue (real), aunque sus
    // ventanas PROGRAMADAS se traslapen. Reasignar B al mixer de A debe permitirse.
    const { plantelId, plantaId } = await crearPlantel({ nombre: "Reales", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[9, 2]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const base = {
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 8, hora_solicitada: DIA,
      plantel_id: plantelId, planta_id: plantaId, tipo_descarga: "Directo", creado_por: "test",
    };
    const rA = await programarPedido(base);
    const rB = await programarPedido(base);
    const viajeA = await prisma.viajes.findFirstOrThrow({ where: { pedido_id: rA.pedidoId, mixer_id: { not: null } } });
    const viajeB = await prisma.viajes.findFirstOrThrow({ where: { pedido_id: rB.pedidoId, mixer_id: { not: null } } });
    const mixerA = viajeA.mixer_id!;
    expect(viajeB.mixer_id).not.toBe(mixerA);

    const h = (hhmm: string) => new Date(`2026-08-01T${hhmm}:00`);
    // A: programado 07:18-08:58 pero COMPLETADO real 07:50-09:45.
    await prisma.viajes.update({
      where: { id: viajeA.id },
      data: {
        estado: "Completado",
        hora_inicio_carga: h("07:18"), hora_regreso_planta: h("08:58"),
        ts_inicio_carga_real: h("07:50"), ts_regreso_real: h("09:45"),
      },
    });
    // B: programado 08:38-10:18 (se traslapa con A programado y con A real) pero
    // su carga REAL fue 10:03 (después de que A regresó de verdad).
    await prisma.viajes.update({
      where: { id: viajeB.id },
      data: {
        estado: "Regresando",
        hora_inicio_carga: h("08:38"), hora_regreso_planta: h("10:18"),
        ts_inicio_carga_real: h("10:03"),
      },
    });

    const res = await reasignarMixer(viajeB.id, mixerA);
    expect(res.ok).toBe(true); // por horas REALES no hay traslape
    const vb = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeB.id } });
    expect(vb.mixer_id).toBe(mixerA);
  });
});

describe("bombas — préstamo por hub (mapa propio)", () => {
  it("un plantel dependiente sin bomba propia toma la bomba del hub", async () => {
    const hub = await crearPlantel({ nombre: "SM Hub B", zona: "Norte", esHub: true });
    await crearMixers(hub.plantelId, [[9, 2]]);
    const dep = await crearPlantel({ nombre: "Villanueva", zona: "Norte", hubId: hub.plantelId });
    const bombaHub = await prisma.bombas.create({
      data: { identificador: "SMB-1", estado: "Disponible", plantel_base_id: hub.plantelId },
    });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 8,
      hora_solicitada: DIA,
      plantel_id: dep.plantelId,
      planta_id: dep.plantaId,
      tipo_descarga: "Bomba estacionaria", // sin bomba_id -> auto por hub
      creado_por: "test",
    });
    const pedido = await prisma.pedidos.findUniqueOrThrow({ where: { id: r.pedidoId } });
    expect(pedido.bomba_id).toBe(bombaHub.id);
  });

  it("prefiere la bomba PROPIA antes que la del hub", async () => {
    const hub = await crearPlantel({ nombre: "SM Hub C", zona: "Norte", esHub: true });
    const dep = await crearPlantel({ nombre: "Pto Cortes", zona: "Norte", hubId: hub.plantelId });
    await crearMixers(dep.plantelId, [[9, 1]]);
    await prisma.bombas.create({
      data: { identificador: "SMC-1", estado: "Disponible", plantel_base_id: hub.plantelId },
    });
    const bombaPropia = await prisma.bombas.create({
      data: { identificador: "PC-1", estado: "Disponible", plantel_base_id: dep.plantelId },
    });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 8,
      hora_solicitada: DIA,
      plantel_id: dep.plantelId,
      planta_id: dep.plantaId,
      tipo_descarga: "Bomba estacionaria",
      creado_por: "test",
    });
    const pedido = await prisma.pedidos.findUniqueOrThrow({ where: { id: r.pedidoId } });
    expect(pedido.bomba_id).toBe(bombaPropia.id); // propia antes que la del hub
  });
});

describe("cancelar pedido — recalcula la cascada (hueco 1)", () => {
  it("al cancelar un pedido temprano, el siguiente en la cola adelanta su carga", async () => {
    // Una planta, dos pedidos a la MISMA hora: el segundo se serializa después
    // del primero. Al cancelar el primero, el segundo debe adelantarse.
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "Cascada",
      zona: "Norte",
      esHub: true,
      capacidadPlantaM3h: 28,
    });
    await crearMixers(plantelId, [[11, 2]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const base = {
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 10,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    };

    const r1 = await programarPedido(base);
    const r2 = await programarPedido(base);

    const viaje2 = r2.viajes.find((v) => v.mixerId != null)!;
    // hora_solicitada es la LLEGADA deseada. Agregar un cliente NO reprograma a
    // nadie: el segundo se queda en la hora que pidió (08:00, misma que el primero)
    // y el motor AVISA del choque en vez de correrlo detrás del primero.
    const antes = await prisma.viajes.findUniqueOrThrow({ where: { id: viaje2.id } });
    expect(Math.abs(antes.hora_llegada_proyecto!.getTime() - DIA.getTime())).toBeLessThan(1000);
    expect(r2.avisosChoque?.length ?? 0).toBeGreaterThan(0);

    // Cancelar el primer pedido → recalcula la cascada de la planta.
    await cancelarPedido(r1.pedidoId);

    const viaje2Post = await prisma.viajes.findUniqueOrThrow({
      where: { id: viaje2.id },
    });
    // Ahora el segundo pedido es el primero de la cola: llega a las 08:00
    // (tolerancia de ms por el redondeo de minutos fraccionarios).
    expect(
      Math.abs(viaje2Post.hora_llegada_proyecto!.getTime() - DIA.getTime()),
    ).toBeLessThan(1000);
  });
});

describe("modificar pedido — re-corre el motor", () => {
  it("al subir el volumen, recalcula los viajes (10 → 22 m³ = 2 viajes de 11)", async () => {
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "Editar",
      zona: "Norte",
      esHub: true,
    });
    await crearMixers(plantelId, [[11, 4]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const base = {
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 10,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    };

    const creado = await programarPedido(base);
    expect(creado.viajes.filter((v) => v.mixerId != null)).toHaveLength(1);

    const mod = await modificarPedido(creado.pedidoId, {
      ...base,
      volumen_total_m3: 22,
    });
    const conMixer = mod.viajes.filter((v) => v.mixerId != null);
    expect(conMixer).toHaveLength(2);
    expect(conMixer.every((v) => v.volumen === 11)).toBe(true);
    expect(mod.volumenSinCubrir).toBe(0);

    // No quedaron viajes huérfanos del pedido anterior.
    const totalViajes = await prisma.viajes.count({
      where: { pedido_id: creado.pedidoId },
    });
    expect(totalViajes).toBe(2);
  });
});

describe("despacho en vivo — avanzar estado (sella ts_*_real, NO toca hora_*)", () => {
  async function nuevoViaje() {
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "Despacho",
      zona: "Norte",
      esHub: true,
    });
    await crearMixers(plantelId, [[11, 1]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 10,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });
    return r.viajes.find((v) => v.mixerId != null)!.id;
  }

  it("sella ts_*_real y deja intacta la programación (hora_*)", async () => {
    const viajeId = await nuevoViaje();
    const base = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });
    const programadoCarga = base.hora_inicio_carga!.getTime();
    const programadoRegreso = base.hora_regreso_planta!.getTime();

    const ahora = new Date("2026-08-01T09:00:00");
    const r1 = await avanzarEstadoViaje(viajeId, "En carga", ahora);
    expect(r1.ok).toBe(true);

    const v1 = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });
    expect(v1.ts_inicio_carga_real!.getTime()).toBe(ahora.getTime()); // real sellado
    expect(v1.hora_inicio_carga!.getTime()).toBe(programadoCarga); // programación intacta

    for (const e of ["En ruta", "Llegada", "Descargando", "Regresando", "Completado"]) {
      const res = await avanzarEstadoViaje(viajeId, e, ahora);
      expect(res.estado).toBe(e);
    }

    const vf = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });
    expect(vf.estado).toBe("Completado");
    expect(vf.ts_regreso_real!.getTime()).toBe(ahora.getTime());
    // La programación NUNCA cambió por el despacho.
    expect(vf.hora_inicio_carga!.getTime()).toBe(programadoCarga);
    expect(vf.hora_regreso_planta!.getTime()).toBe(programadoRegreso);
  });

  it("rechaza saltar pasos (el servidor valida la secuencia)", async () => {
    const viajeId = await nuevoViaje();
    const salto = await avanzarEstadoViaje(viajeId, "Descargando");
    expect(salto.ok).toBe(false);
    expect(salto.mensaje).toMatch(/En carga/);
  });

  it("el paso Llegada sella ts_llegada_real, separado de la descarga", async () => {
    const viajeId = await nuevoViaje();
    const ahora = new Date("2026-08-01T09:00:00");
    await avanzarEstadoViaje(viajeId, "En carga", ahora);
    await avanzarEstadoViaje(viajeId, "En ruta", ahora);
    const r = await avanzarEstadoViaje(viajeId, "Llegada", ahora);
    expect(r.ok).toBe(true);
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });
    expect(v.ts_llegada_real!.getTime()).toBe(ahora.getTime());
    expect(v.ts_inicio_descarga_real).toBeNull(); // llegó pero aún no descarga
    await avanzarEstadoViaje(viajeId, "Descargando", ahora);
    const v2 = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });
    expect(v2.ts_inicio_descarga_real!.getTime()).toBe(ahora.getTime());
  });

  it("corregir hora real: valida orden lógico y registra en bitácora", async () => {
    const viajeId = await nuevoViaje();
    await avanzarEstadoViaje(viajeId, "En carga", new Date("2026-08-01T09:00:00"));
    await avanzarEstadoViaje(viajeId, "En ruta", new Date("2026-08-01T09:20:00"));

    // Inválida: inicio de carga después de la salida → rechazada.
    const malo = await corregirHoraReal(
      viajeId,
      "ts_inicio_carga_real",
      new Date("2026-08-01T09:30:00"),
      "tester",
    );
    expect(malo.ok).toBe(false);

    // Válida: corrección coherente → ok + fila en bitácora.
    const bueno = await corregirHoraReal(
      viajeId,
      "ts_inicio_carga_real",
      new Date("2026-08-01T08:50:00"),
      "tester",
    );
    expect(bueno.ok).toBe(true);

    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });
    expect(v.ts_inicio_carga_real!.getTime()).toBe(
      new Date("2026-08-01T08:50:00").getTime(),
    );
    const auditoria = await prisma.bitacora_auditoria.count({
      where: { tabla_afectada: "viajes", registro_id: viajeId },
    });
    expect(auditoria).toBeGreaterThanOrEqual(1);
  });
});

describe("Paso 3 — confirmar refuerzo excepcional", () => {
  it("cubre el volumen faltante con un mixer de otro plantel", async () => {
    // Satélite y su hub SIN ninguna flota → todo el pedido queda sin cubrir
    // (no hay mixer que reutilizar). Otro plantel tiene un 11 libre → refuerzo.
    const hub = await crearPlantel({ nombre: "HubSinFlota", zona: "Norte", esHub: true });
    // hub sin mixers a propósito.
    const satelite = await crearPlantel({
      nombre: "Satelite",
      zona: "Norte",
      hubId: hub.plantelId,
    });
    // Otro plantel con un mixer libre de 11 → candidato de refuerzo.
    const otro = await crearPlantel({ nombre: "Otro", zona: "Norte", esHub: true });
    await crearMixers(otro.plantelId, [[11, 1]]);

    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 20,
      hora_solicitada: DIA,
      plantel_id: satelite.plantelId,
      planta_id: satelite.plantaId,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });
    // Sin flota propia ni en el hub → 20 m³ sin cubrir.
    expect(r.volumenSinCubrir).toBeCloseTo(20, 5);
    expect(r.sugerenciasRefuerzo.length).toBeGreaterThan(0);

    const mixerOtro = await prisma.mixers.findFirstOrThrow({
      where: { plantel_base_id: otro.plantelId },
    });

    const res = await confirmarRefuerzo(r.pedidoId, mixerOtro.id);
    expect(res.ok).toBe(true);

    // Se creó un viaje de "Refuerzo excepcional" con ese mixer.
    const refuerzo = await prisma.viajes.findFirst({
      where: { pedido_id: r.pedidoId, motivo_asignacion: "Refuerzo excepcional" },
    });
    expect(refuerzo?.mixer_id).toBe(mixerOtro.id);
    expect(refuerzo?.volumen_asignado_m3).toBe(11);

    // El sin cubrir bajó de 20 a 9.
    const restante = await prisma.viajes.aggregate({
      where: { pedido_id: r.pedidoId, motivo_asignacion: "Sin cubrir" },
      _sum: { volumen_asignado_m3: true },
    });
    expect(restante._sum.volumen_asignado_m3).toBeCloseTo(9, 5);
  });
});

describe("despacho — motorista preseleccionado y volumen editable", () => {
  it("preselecciona el operador del mixer y respeta el gate del volumen", async () => {
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "Op",
      zona: "Norte",
      esHub: true,
    });
    await crearMixers(plantelId, [[11, 1]]);
    const op = await prisma.operadores.create({
      data: { nombre: "Motorista X", estado: "Disponible" },
    });
    const mx = await prisma.mixers.findFirstOrThrow({
      where: { plantel_base_id: plantelId },
    });
    await prisma.mixers.update({
      where: { id: mx.id },
      data: { operador_asignado_id: op.id },
    });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 10,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });
    const viajeId = r.viajes.find((v) => v.mixerId != null)!.id;

    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });
    expect(v.operador_id).toBe(op.id); // motorista del mixer preseleccionado

    // Editable mientras Programado.
    expect((await editarVolumenViaje(viajeId, 8, "t")).ok).toBe(true);
    // No puede exceder la capacidad del mixer.
    expect((await editarVolumenViaje(viajeId, 20, "t")).ok).toBe(false);

    // Tras salir de carga (En ruta sella ts_fin_carga_real) → bloqueado.
    await avanzarEstadoViaje(viajeId, "En carga");
    await avanzarEstadoViaje(viajeId, "En ruta");
    const bloqueado = await editarVolumenViaje(viajeId, 7, "t");
    expect(bloqueado.ok).toBe(false);
    expect(bloqueado.mensaje).toMatch(/carga/i);
  });
});

describe("orden de atención (orden_dia) — reordenar y recalcular", () => {
  it("mover el pedido #5 a #2 reacomoda la secuencia y recalcula los horarios", async () => {
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "Cola",
      zona: "Norte",
      esHub: true,
      capacidadPlantaM3h: 45,
    });
    await crearMixers(plantelId, [[11, 5]]); // suficientes: la planta es el cuello
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const base = {
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 10,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Directo",
      creado_por: "test",
    };

    // 5 pedidos → orden_dia 1..5 en orden de creación.
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push((await programarPedido({ ...base })).pedidoId);
    for (let i = 0; i < 5; i++) {
      const p = await prisma.pedidos.findUniqueOrThrow({
        where: { id: ids[i] },
        select: { orden_dia: true },
      });
      expect(p.orden_dia).toBe(i + 1);
    }

    // Mover el #5 a la posición #2.
    const res = await reordenarPedidoDia(ids[4], 2, "tester");
    expect(res.ok).toBe(true);

    const orden = async (id: number) =>
      (await prisma.pedidos.findUniqueOrThrow({ where: { id }, select: { orden_dia: true } }))
        .orden_dia;
    // Secuencia esperada: 1, 2(el que era 5), 3(era 2), 4(era 3), 5(era 4).
    expect(await orden(ids[0])).toBe(1);
    expect(await orden(ids[4])).toBe(2);
    expect(await orden(ids[1])).toBe(3);
    expect(await orden(ids[2])).toBe(4);
    expect(await orden(ids[3])).toBe(5);

    // Horarios recalculados en el NUEVO orden (misma planta → secuencial).
    const carga = async (pedidoId: number) => {
      const v = await prisma.viajes.findFirstOrThrow({
        where: { pedido_id: pedidoId, mixer_id: { not: null } },
        orderBy: { hora_inicio_carga: "asc" },
      });
      return v.hora_inicio_carga!.getTime();
    };
    const c1 = await carga(ids[0]);
    const c5 = await carga(ids[4]);
    const c2 = await carga(ids[1]);
    const c3 = await carga(ids[2]);
    const c4 = await carga(ids[3]);
    expect(c1).toBeLessThanOrEqual(c5);
    expect(c5).toBeLessThan(c2);
    expect(c2).toBeLessThan(c3);
    expect(c3).toBeLessThan(c4);

    // Queda registro en bitácora del cambio de orden.
    const audit = await prisma.bitacora_auditoria.count({
      where: { tabla_afectada: "pedidos", registro_id: ids[4], campo_modificado: "orden_dia" },
    });
    expect(audit).toBeGreaterThanOrEqual(1);
  });

  it("un pedido con HORA FIJA llega a su hora aunque la planta esté libre antes", async () => {
    // 1 pedido temprano (auto) + 1 pedido de la TARDE con hora fija. El de la
    // tarde NO debe empaquetarse tras el primero: respeta su llegada fija.
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "HoraFija",
      zona: "Norte",
      esHub: true,
      capacidadPlantaM3h: 45,
    });
    await crearMixers(plantelId, [[11, 3]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const base = {
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 6,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Directo",
      creado_por: "test",
    };
    const manana = new Date("2026-08-01T08:00:00");
    const tarde = new Date("2026-08-01T14:00:00");

    await programarPedido({ ...base, hora_solicitada: manana });
    const fijo = await programarPedido({
      ...base,
      hora_solicitada: tarde,
      hora_bloqueada: true,
    });

    const viaje = await prisma.viajes.findFirstOrThrow({
      where: { pedido_id: fijo.pedidoId, mixer_id: { not: null } },
      orderBy: { hora_inicio_carga: "asc" },
    });
    // Llega a las 14:00 (± ms), no ~08:20 tras el primero.
    expect(
      Math.abs(viaje.hora_llegada_proyecto!.getTime() - tarde.getTime()),
    ).toBeLessThan(1000);
    // El de la mañana sigue en su horario automático (llega ~08:00).
    const vManana = await prisma.viajes.findFirstOrThrow({
      where: { pedido: { hora_bloqueada: false }, mixer_id: { not: null } },
      orderBy: { hora_inicio_carga: "asc" },
    });
    expect(vManana.hora_llegada_proyecto!.getTime()).toBeLessThan(tarde.getTime());
  });

  it("al pasar a la posición 1, el pedido LLEGA a la hora de inicio de jornada (no la suya)", async () => {
    // hora_solicitada = LLEGADA. El primero define el inicio de jornada (la
    // llegada más temprana); el resto se encadena tras él.
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "Jornada",
      zona: "Norte",
      esHub: true,
      capacidadPlantaM3h: 45,
    });
    await crearMixers(plantelId, [[11, 5]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const base = {
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 10,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Directo",
      creado_por: "test",
    };
    const h8 = new Date("2026-08-01T08:00:00"); // inicio de jornada (llegada más temprana)
    const h10 = new Date("2026-08-01T10:00:00"); // este pedido pidió llegar más tarde

    await programarPedido({ ...base, hora_solicitada: h8 });
    await programarPedido({ ...base, hora_solicitada: h8 });
    const p3 = await programarPedido({ ...base, hora_solicitada: h10 });

    const llegadaDe = async (id: number) =>
      (
        await prisma.viajes.findFirstOrThrow({
          where: { pedido_id: id, mixer_id: { not: null } },
          orderBy: { hora_inicio_carga: "asc" },
        })
      ).hora_llegada_proyecto!.getTime();

    // Mover el 3º a la posición 1.
    await reordenarPedidoDia(p3.pedidoId, 1, "tester");

    // Debe LLEGAR a las 08:00 (inicio de jornada), y su inicio de carga se calcula
    // hacia atrás restando carga + transporte (tolerancia de ms por redondeo).
    expect(Math.abs((await llegadaDe(p3.pedidoId)) - h8.getTime())).toBeLessThan(1000);
  });
});

describe("sugerir hora solicitada — próxima disponibilidad de la planta", () => {
  it("con 2 pedidos ya en la planta, sugiere el primer hueco tras ellos (no la apertura)", async () => {
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "Sugerir",
      zona: "Norte",
      esHub: true,
      capacidadPlantaM3h: 45,
    });
    await crearMixers(plantelId, [[11, 5]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const base = {
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 10,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Directo",
      creado_por: "test",
    };
    await programarPedido({ ...base });
    await programarPedido({ ...base });

    const viajes = await prisma.viajes.findMany({
      where: { pedido: { planta_id: plantaId }, hora_fin_carga: { not: null } },
      select: { hora_fin_carga: true },
    });
    const maxFin = Math.max(...viajes.map((v) => v.hora_fin_carga!.getTime()));

    // hora_solicitada = LLEGADA. La sugerencia = llegada si se carga en el primer
    // hueco libre = fin de carga de la cola + salida + transporte (> maxFin).
    const sug = await sugerirHoraDisponible(plantaId, DIA, 10, clienteId);
    expect(sug.getTime()).toBeGreaterThan(maxFin);
  });
});

describe("asesor del pedido (Punto 6)", () => {
  it("programarPedido guarda el asesor_id recibido del formulario", async () => {
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "AsesorTest",
      zona: "Norte",
      esHub: true,
    });
    await crearMixers(plantelId, [[11, 1]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const asesor = await prisma.asesores.create({ data: { nombre: "Vendedor A" } });

    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 10,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Directo",
      asesor_id: asesor.id,
      creado_por: "test",
    });

    const pedido = await prisma.pedidos.findUniqueOrThrow({ where: { id: r.pedidoId } });
    expect(pedido.asesor_id).toBe(asesor.id);
  });
});

describe("bombas — traslape / margen en la alerta (hueco 2)", () => {
  it("dos pedidos con la misma bomba en descarga simultánea generan alerta de bomba", async () => {
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "Con Bomba",
      zona: "Norte",
      esHub: true,
      capacidadPlantaM3h: 28,
    });
    await crearMixers(plantelId, [[11, 4]]);
    const bomba = await prisma.bombas.create({
      data: {
        identificador: "TB-1",
        estado: "Disponible",
        plantel_base_id: plantelId,
      },
    });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();

    const base = {
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 10,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      bomba_id: bomba.id,
      tipo_descarga: "Bomba estacionaria", // descarga larga → traslape de bomba
      creado_por: "test",
    };

    await programarPedido(base);
    await programarPedido(base);

    const alertas = await detectarAlertasMargen(DIA);
    const alertaBomba = alertas.find((a) => a.tipoUnidad === "bomba");
    expect(alertaBomba).toBeDefined();
    expect(alertaBomba!.unidadId).toBe(bomba.id);
    // Descarga simultánea de la misma bomba → margen por debajo del mínimo.
    expect(alertaBomba!.margenMin).toBeLessThan(10);
  });
});

describe("Hito 6 — mantenimiento excluye unidades del motor", () => {
  const base = (clienteId: number, disenoId: number) => ({
    cliente_id: clienteId,
    diseno_id: disenoId,
    volumen_total_m3: 8,
    hora_solicitada: DIA,
    tipo_descarga: "Canal directo",
    creado_por: "test",
  });

  it("un mixer en mantenimiento ese día NO se asigna (queda sin cubrir si es el único)", async () => {
    const p = await crearPlantel({ nombre: "M-Hub", zona: "Norte", esHub: true });
    await crearMixers(p.plantelId, [[11, 1]]); // un solo mixer
    const mixer = await prisma.mixers.findFirstOrThrow();
    // Mantenimiento programado que cubre DIA.
    await prisma.disponibilidad_flota.create({
      data: {
        unidad_tipo: "Mixer",
        unidad_id: mixer.id,
        fecha_inicio: new Date("2026-07-31T00:00:00"),
        fecha_fin: new Date("2026-08-02T00:00:00"),
        tipo_evento: "Mantenimiento_Programado",
        estado: "Programado",
        creado_por: "test",
      },
    });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      ...base(clienteId, disenoId),
      plantel_id: p.plantelId,
      planta_id: p.plantaId,
    });
    // El único mixer está en mantenimiento → nada que asignar.
    expect(r.volumenSinCubrir).toBeGreaterThan(0);
  });

  it("con mantenimiento en un mixer, el motor usa el otro disponible", async () => {
    const p = await crearPlantel({ nombre: "M2-Hub", zona: "Norte", esHub: true });
    await crearMixers(p.plantelId, [[11, 2]]);
    const [m1, m2] = await prisma.mixers.findMany({ orderBy: { id: "asc" } });
    await prisma.disponibilidad_flota.create({
      data: {
        unidad_tipo: "Mixer",
        unidad_id: m1.id,
        fecha_inicio: new Date("2026-08-01T00:00:00"),
        fecha_fin: new Date("2026-08-01T00:00:00"),
        tipo_evento: "Mantenimiento_Programado",
        estado: "Programado",
        creado_por: "test",
      },
    });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      ...base(clienteId, disenoId),
      plantel_id: p.plantelId,
      planta_id: p.plantaId,
    });
    expect(r.volumenSinCubrir).toBe(0);
    const viajes = await prisma.viajes.findMany({ where: { pedido_id: r.pedidoId } });
    expect(viajes.every((v) => v.mixer_id !== m1.id)).toBe(true); // nunca el que está en mantenimiento
    expect(viajes.some((v) => v.mixer_id === m2.id)).toBe(true);
  });

  it("reasignarMixer rechaza un mixer en mantenimiento con mensaje claro", async () => {
    const p = await crearPlantel({ nombre: "M3-Hub", zona: "Norte", esHub: true });
    await crearMixers(p.plantelId, [[11, 2]]);
    const [m1, m2] = await prisma.mixers.findMany({ orderBy: { id: "asc" } });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      ...base(clienteId, disenoId),
      plantel_id: p.plantelId,
      planta_id: p.plantaId,
    });
    const viaje = await prisma.viajes.findFirstOrThrow({ where: { pedido_id: r.pedidoId } });
    const enMant = viaje.mixer_id === m1.id ? m2 : m1; // el mixer libre al que intentaremos mover
    await prisma.disponibilidad_flota.create({
      data: {
        unidad_tipo: "Mixer",
        unidad_id: enMant.id,
        fecha_inicio: new Date("2026-08-01T00:00:00"),
        fecha_fin: new Date("2026-08-03T00:00:00"),
        tipo_evento: "Mantenimiento_Programado",
        estado: "Programado",
        creado_por: "test",
      },
    });
    const res = await reasignarMixer(viaje.id, enMant.id);
    expect(res.ok).toBe(false);
    expect(res.motivo?.toLowerCase()).toContain("mantenimiento");
  });
});

describe("planta por viaje (planteles de 2 plantas)", () => {
  it("con usar_ambas_plantas reparte los viajes entre las 2 plantas del plantel", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "Doble", zona: "Norte", esHub: true });
    await prisma.plantas.create({ data: { plantel_id: plantelId, nombre: "SANY", capacidad_m3h: 45 } });
    await crearMixers(plantelId, [[9, 4]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 36, hora_solicitada: DIA,
      plantel_id: plantelId, planta_id: plantaId, tipo_descarga: "Directo", creado_por: "test",
      usar_ambas_plantas: true,
    });
    const viajes = await prisma.viajes.findMany({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
      select: { planta_id: true },
    });
    expect(viajes.length).toBe(4);
    // Debe haber usado AMBAS plantas (reparto por hueco más temprano).
    expect(new Set(viajes.map((v) => v.planta_id)).size).toBe(2);
  });

  it("con flota escasa, las 2 plantas cargan EN PARALELO (no una tras otra)", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "Paral", zona: "Norte", esHub: true });
    await prisma.plantas.create({ data: { plantel_id: plantelId, nombre: "SANY", capacidad_m3h: 45 } });
    // Flota escasa a propósito: sin paralelizar, la primera planta acapara los mixers
    // y la segunda arranca ~2 h después (el bug que reproducíamos).
    await crearMixers(plantelId, [[11, 6]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 176, hora_solicitada: DIA,
      plantel_id: plantelId, planta_id: plantaId, tipo_descarga: "Directo", creado_por: "test",
      usar_ambas_plantas: true,
    });
    const viajes = await prisma.viajes.findMany({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null }, hora_inicio_carga: { not: null } },
      select: { planta_id: true, hora_inicio_carga: true },
    });
    expect(new Set(viajes.map((v) => v.planta_id)).size).toBe(2); // ambas plantas
    // Primer inicio de carga de CADA planta ~ a la misma hora (paralelo).
    const minPorPlanta = new Map<number, number>();
    for (const v of viajes) {
      const t = v.hora_inicio_carga!.getTime();
      minPorPlanta.set(v.planta_id!, Math.min(minPorPlanta.get(v.planta_id!) ?? Infinity, t));
    }
    const mins = [...minPorPlanta.values()];
    const difMin = Math.abs(mins[0] - mins[1]) / 60000;
    expect(difMin).toBeLessThanOrEqual(25); // antes del arreglo: ~150 min de diferencia
  });

  it("carga_simultanea fuerza que ambas plantas arranquen a la MISMA hora", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "Sim", zona: "Norte", esHub: true });
    await prisma.plantas.create({ data: { plantel_id: plantelId, nombre: "SANY", capacidad_m3h: 45 } });
    await crearMixers(plantelId, [[11, 6]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 88, hora_solicitada: DIA,
      plantel_id: plantelId, planta_id: plantaId, tipo_descarga: "Directo", creado_por: "test",
      usar_ambas_plantas: true, carga_simultanea: true,
    });
    const viajes = await prisma.viajes.findMany({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null }, hora_inicio_carga: { not: null } },
      orderBy: { hora_inicio_carga: "asc" },
      select: { planta_id: true, hora_inicio_carga: true },
    });
    // Primer viaje de cada planta EXACTAMENTE a la misma hora (arranque sincronizado).
    const primera = new Map<number, number>();
    for (const v of viajes) {
      if (!primera.has(v.planta_id!)) primera.set(v.planta_id!, v.hora_inicio_carga!.getTime());
    }
    const arranques = [...primera.values()];
    expect(arranques.length).toBe(2);
    expect(arranques[0]).toBe(arranques[1]); // misma hora_inicio_carga
  });

  // Regresión (bug real ago-2026): con OTRO pedido ocupando una de las plantas ese
  // día, la carga_simultanea repartía TODOS los viajes a la otra planta (0 en una) por
  // un error de escala en `repartirPlantas` (planta vacía comparada contra epoch 0 vs
  // el timestamp real de la ocupada) → simultaneidad imposible. Ahora el reparto de un
  // pedido con carga_simultanea es BALANCEADO: ambas plantas reciben viajes sí o sí.
  it("carga_simultanea reparte en AMBAS plantas aunque otro pedido ocupe una", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SimOcup", zona: "Norte", esHub: true });
    const sany = await prisma.plantas.create({
      data: { plantel_id: plantelId, nombre: "SANY", capacidad_m3h: 45 },
    });
    await crearMixers(plantelId, [[11, 6], [9, 4]]);
    const clienteId = await crearCliente(true, 30, 30);
    const disenoId = await crearDiseno();

    // Pedido simultáneo (grande, mañana) PRIMERO → es la ancla del día.
    const rSim = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 120,
      hora_solicitada: new Date("2026-08-01T08:00:00"),
      plantel_id: plantelId, planta_id: plantaId, tipo_descarga: "Directo", creado_por: "test",
      usar_ambas_plantas: true, carga_simultanea: true, hora_bloqueada: true,
    });
    // Otro pedido DESPUÉS que ocupa SANY por la tarde (antes tiraba todo a la otra planta).
    await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 18,
      hora_solicitada: new Date("2026-08-01T13:00:00"),
      plantel_id: plantelId, planta_id: sany.id, tipo_descarga: "Directo", creado_por: "test",
      hora_bloqueada: true,
    });

    const viajes = await prisma.viajes.findMany({
      where: { pedido_id: rSim.pedidoId, mixer_id: { not: null }, hora_inicio_carga: { not: null } },
      select: { planta_id: true, hora_inicio_carga: true },
    });
    // El pedido simultáneo quedó repartido en las DOS plantas (ninguna en 0).
    const porPlanta = new Map<number, number>();
    for (const v of viajes) porPlanta.set(v.planta_id!, (porPlanta.get(v.planta_id!) ?? 0) + 1);
    expect(porPlanta.size).toBe(2);
    expect([...porPlanta.values()].every((n) => n > 0)).toBe(true);
    // Y como es la ancla (creado primero), ambas plantas arrancan a la misma hora.
    const primera = new Map<number, number>();
    for (const v of viajes) {
      const t = v.hora_inicio_carga!.getTime();
      primera.set(v.planta_id!, Math.min(primera.get(v.planta_id!) ?? Infinity, t));
    }
    const arranques = [...primera.values()];
    expect(arranques[0]).toBe(arranques[1]); // simultáneo pese al otro pedido
  });

  it("carga_reducida usa la capacidad EFECTIVA (config) en vez de la nominal", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "Red", zona: "Norte", esHub: true });
    // Físico 12 (crearMixers suma el margen). Config: 12 → efectiva 10.
    await crearMixers(plantelId, [[11, 4]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 20, hora_solicitada: DIA,
      plantel_id: plantelId, planta_id: plantaId, tipo_descarga: "Directo", creado_por: "test",
      carga_reducida: true,
    });
    const viajes = await prisma.viajes.findMany({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
    });
    // 20 m³ con carga efectiva 10 → 10 + 10 (2 viajes de 10), NO 11 + 9.
    expect(viajes.length).toBe(2);
    expect(viajes.every((v) => v.capacidad_asignada_m3 === 10)).toBe(true);
    expect(viajes.reduce((s, v) => s + v.volumen_asignado_m3, 0)).toBeCloseTo(20, 5);
  });

  it("por defecto (sin usar_ambas_plantas) TODO carga en la planta elegida", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "Doble3", zona: "Norte", esHub: true });
    await prisma.plantas.create({ data: { plantel_id: plantelId, nombre: "SANY3", capacidad_m3h: 45 } });
    await crearMixers(plantelId, [[9, 4]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 36, hora_solicitada: DIA,
      plantel_id: plantelId, planta_id: plantaId, tipo_descarga: "Directo", creado_por: "test",
    });
    const viajes = await prisma.viajes.findMany({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
      select: { planta_id: true },
    });
    expect(viajes.length).toBe(4);
    // Sin el flag, todos los viajes quedan en la planta seleccionada.
    expect(viajes.every((v) => v.planta_id === plantaId)).toBe(true);
  });

  it("cambiarPlantaViaje mueve un viaje a la otra planta y lo reprograma", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "Doble2", zona: "Norte", esHub: true });
    const planta2 = await prisma.plantas.create({ data: { plantel_id: plantelId, nombre: "SANY2", capacidad_m3h: 45 } });
    await crearMixers(plantelId, [[9, 2]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 9, hora_solicitada: DIA,
      plantel_id: plantelId, planta_id: plantaId, tipo_descarga: "Directo", creado_por: "test",
    });
    const viaje = await prisma.viajes.findFirstOrThrow({ where: { pedido_id: r.pedidoId, mixer_id: { not: null } } });
    const destino = viaje.planta_id === plantaId ? planta2.id : plantaId;
    const res = await cambiarPlantaViaje(viaje.id, destino);
    expect(res.ok).toBe(true);
    const v2 = await prisma.viajes.findUniqueOrThrow({ where: { id: viaje.id } });
    expect(v2.planta_id).toBe(destino);
    expect(v2.hora_inicio_carga).not.toBeNull(); // reprogramado en la nueva planta
  });

  it("cambiarPlantaViaje rechaza una planta de OTRO plantel", async () => {
    const a = await crearPlantel({ nombre: "PlA", zona: "Norte", esHub: true });
    await crearMixers(a.plantelId, [[9, 1]]);
    const b = await crearPlantel({ nombre: "PlB", zona: "Norte", hubId: a.plantelId });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 8, hora_solicitada: DIA,
      plantel_id: a.plantelId, planta_id: a.plantaId, tipo_descarga: "Directo", creado_por: "test",
    });
    const viaje = await prisma.viajes.findFirstOrThrow({ where: { pedido_id: r.pedidoId } });
    const res = await cambiarPlantaViaje(viaje.id, b.plantaId);
    expect(res.ok).toBe(false);
  });
});

describe("adiciones y congelamiento del Programa DPCR-08", () => {
  it("agregarVolumenAlPedido suma viajes SIN tocar volumen_programado (adición)", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "Adi", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[9, 4]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 9, hora_solicitada: DIA,
      plantel_id: plantelId, planta_id: plantaId, tipo_descarga: "Directo", creado_por: "test",
    });
    const antes = await prisma.pedidos.findUniqueOrThrow({ where: { id: r.pedidoId } });
    const viajesAntes = await prisma.viajes.count({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
    });

    await agregarVolumenAlPedido(r.pedidoId, 18);

    const despues = await prisma.pedidos.findUniqueOrThrow({ where: { id: r.pedidoId } });
    const viajesDespues = await prisma.viajes.count({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
    });
    expect(despues.volumen_total_m3).toBeCloseTo(antes.volumen_total_m3 + 18);
    // La línea base NO cambia: el exceso queda como adición en métricas comerciales.
    expect(despues.volumen_programado).toBe(antes.volumen_programado);
    expect(viajesDespues).toBeGreaterThan(viajesAntes);
    // Los viajes AGREGADOS quedan marcados es_adicion=true (no van al DPCR-08); los
    // viajes originales del programa siguen es_adicion=false.
    const agregados = await prisma.viajes.count({
      where: { pedido_id: r.pedidoId, es_adicion: true },
    });
    const programa = await prisma.viajes.count({
      where: { pedido_id: r.pedidoId, es_adicion: false, mixer_id: { not: null } },
    });
    expect(agregados).toBeGreaterThan(0);
    expect(programa).toBeGreaterThan(0);
  });

  it("cancelar DESPUÉS del cierre conserva mixer/horarios (documento congelado)", async () => {
    // DIA (2026-08-01) ya pasó el cierre (16:00 del día anterior) respecto a hoy.
    const { plantelId, plantaId } = await crearPlantel({ nombre: "Cong", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[9, 2]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 9, hora_solicitada: DIA,
      plantel_id: plantelId, planta_id: plantaId, tipo_descarga: "Directo", creado_por: "test",
    });
    const res = await cancelarPedidoConMotivo(r.pedidoId, "Clima o Lluvia", null, "test");
    expect(res.viajesRecalculados).toEqual([]); // no se recalcula (no corre a los demás)
    const ped = await prisma.pedidos.findUniqueOrThrow({ where: { id: r.pedidoId } });
    expect(ped.estado_pedido).toBe("Cancelado");
    const viajes = await prisma.viajes.findMany({ where: { pedido_id: r.pedidoId } });
    expect(viajes.every((v) => v.estado === "Cancelado")).toBe(true);
    // Congelado: conserva el mixer publicado (no se libera del registro).
    expect(viajes.some((v) => v.mixer_id != null)).toBe(true);
  });

  it("cancelar ANTES del cierre libera el mixer (programa aún no publicado)", async () => {
    // Fecha 10 días adelante: el cierre (16:00 del día anterior) todavía no llega.
    const FUTURO = new Date();
    FUTURO.setDate(FUTURO.getDate() + 10);
    FUTURO.setHours(8, 0, 0, 0);
    const { plantelId, plantaId } = await crearPlantel({ nombre: "PreC", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[9, 2]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 9, hora_solicitada: FUTURO,
      plantel_id: plantelId, planta_id: plantaId, tipo_descarga: "Directo", creado_por: "test",
    });
    await cancelarPedidoConMotivo(r.pedidoId, "Clima o Lluvia", null, "test");
    const viajes = await prisma.viajes.findMany({ where: { pedido_id: r.pedidoId } });
    expect(viajes.every((v) => v.estado === "Cancelado")).toBe(true);
    // Antes del cierre: se libera la flota (mixer null).
    expect(viajes.every((v) => v.mixer_id == null)).toBe(true);
  });

  it("hora de carga manual (Admin) reubica la carga del pedido a la hora fijada", async () => {
    // Guardado por el flag: si el override está deshabilitado (revertido), no aplica.
    if (!PERMITIR_HORA_CARGA_MANUAL) return;
    const { plantelId, plantaId } = await crearPlantel({ nombre: "Man", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[9, 2]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 9, hora_solicitada: DIA,
      plantel_id: plantelId, planta_id: plantaId, tipo_descarga: "Directo", creado_por: "test",
    });
    // Fijar la carga a las 05:00 (bien distinta de la calculada por la cascada).
    const manual = new Date("2026-08-01T05:00:00");
    await prisma.pedidos.update({ where: { id: r.pedidoId }, data: { hora_carga_manual: manual } });
    await recalcularCascadaPlanta(plantaId, DIA);
    const viajes = await prisma.viajes.findMany({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
      orderBy: { hora_inicio_carga: "asc" },
    });
    expect(viajes.length).toBeGreaterThan(0);
    expect(viajes[0].hora_inicio_carga?.getTime()).toBe(manual.getTime());

    // Volver a automático: la cascada recalcula y la carga deja de ser la manual.
    await prisma.pedidos.update({ where: { id: r.pedidoId }, data: { hora_carga_manual: null } });
    await recalcularCascadaPlanta(plantaId, DIA);
    const auto = await prisma.viajes.findFirst({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
      orderBy: { hora_inicio_carga: "asc" },
    });
    expect(auto?.hora_inicio_carga?.getTime()).not.toBe(manual.getTime());
  });
});

describe("carga segura de planeacion vs capacidad fisica del mixer", () => {
  it("la programacion automatica usa la carga segura (fisica - margen), no sobrecarga", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "Seg", zona: "Norte", esHub: true });
    // Carga usable 9 -> el helper crea un mixer FISICO de 10.
    await crearMixers(plantelId, [[9, 1]]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 10, hora_solicitada: DIA,
      plantel_id: plantelId, planta_id: plantaId, tipo_descarga: "Directo", creado_por: "test",
    });
    const viajes = await prisma.viajes.findMany({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
      orderBy: { volumen_asignado_m3: "desc" },
    });
    // 10 m3 en un mixer fisico de 10 pero con carga segura 9 -> 2 viajes (9 + 1),
    // NO un solo viaje de 10 (eso seria sobrecargar la unidad).
    expect(viajes.length).toBe(2);
    expect(viajes[0].volumen_asignado_m3).toBe(9);
    expect(viajes[0].capacidad_asignada_m3).toBe(9); // carga segura, no la fisica (10)
  });

  it("en emergencia el despacho permite cargar hasta la capacidad fisica", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "Emer", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[9, 1]]); // fisico 10
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 9, hora_solicitada: DIA,
      plantel_id: plantelId, planta_id: plantaId, tipo_descarga: "Directo", creado_por: "test",
    });
    const trip = await prisma.viajes.findFirstOrThrow({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
    });
    // Por encima de la capacidad fisica (10) -> rechazado.
    expect((await editarVolumenViaje(trip.id, 10.5, "test")).ok).toBe(false);
    // Hasta la fisica (10), aunque supere la carga segura (9) -> permitido (emergencia).
    expect((await editarVolumenViaje(trip.id, 10, "test")).ok).toBe(true);
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: trip.id } });
    expect(v.volumen_asignado_m3).toBe(10);
  });
});

describe("adiciones/cancelaciones comerciales = diferencia suministrado vs programado", () => {
  // Prepara un asesor con un cliente y un pedido; marca todos sus viajes Completado
  // (suministrado) y fija el volumen programado (linea base congelada). Devuelve los
  // totales comerciales del mes de DIA.
  async function escenario(volumenPedido: number, programado: number) {
    const { plantelId, plantaId } = await crearPlantel({ nombre: `C${volumenPedido}`, zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 6]]); // fisico 12, carga segura 11
    const asesor = await prisma.asesores.create({ data: { nombre: `Ase ${volumenPedido}` } });
    const clienteId = await crearCliente(true);
    await prisma.clientes.update({ where: { id: clienteId }, data: { asesor_id: asesor.id } });
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: volumenPedido, hora_solicitada: DIA,
      plantel_id: plantelId, planta_id: plantaId, tipo_descarga: "Directo", creado_por: "test",
    });
    // Suministrado = todos los viajes Completado; programado = linea base congelada.
    await prisma.viajes.updateMany({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
      data: { estado: "Completado" },
    });
    await prisma.pedidos.update({ where: { id: r.pedidoId }, data: { volumen_programado: programado } });
    return calcularDesempeno({ anio: DIA.getFullYear(), mes: DIA.getMonth() + 1, zona: null });
  }

  it("programado 50, suministrado 40 -> cancelacion 10 m3", async () => {
    const res = await escenario(40, 50);
    expect(res.cancelacionesM3Total).toBeCloseTo(10, 5);
    expect(res.adicionesM3Total).toBeCloseTo(0, 5);
  });

  it("programado 50, suministrado 55 -> adicion 5 m3", async () => {
    const res = await escenario(55, 50);
    expect(res.adicionesM3Total).toBeCloseTo(5, 5);
    expect(res.cancelacionesM3Total).toBeCloseTo(0, 5);
  });

  it("pedido de ADICION (Despacho) tiene base 0 y todo lo suministrado es adicion", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "Adi2", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 4]]);
    const asesor = await prisma.asesores.create({ data: { nombre: "AseAdi" } });
    const clienteId = await crearCliente(true);
    await prisma.clientes.update({ where: { id: clienteId }, data: { asesor_id: asesor.id } });
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 20, hora_solicitada: DIA,
      plantel_id: plantelId, planta_id: plantaId, tipo_descarga: "Directo", creado_por: "test",
      es_adicion: true, // creado desde Despacho en vivo
    });
    const ped = await prisma.pedidos.findUniqueOrThrow({ where: { id: r.pedidoId } });
    expect(ped.es_adicion).toBe(true);
    expect(ped.volumen_programado).toBe(0); // una adicion no tiene linea base de programa
    // Suministra todo -> todo cuenta como adicion (no cancelacion).
    await prisma.viajes.updateMany({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
      data: { estado: "Completado" },
    });
    const res = await calcularDesempeno({ anio: DIA.getFullYear(), mes: DIA.getMonth() + 1, zona: null });
    expect(res.adicionesM3Total).toBeCloseTo(20, 5);
    expect(res.cancelacionesM3Total).toBeCloseTo(0, 5);
  });

  it("recalcularTransportePromedioCliente ajusta el transporte al promedio real", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "Trans", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 3]]);
    const clienteId = await crearCliente(true); // arranca con 20 min de referencia
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 20, hora_solicitada: DIA,
      plantel_id: plantelId, planta_id: plantaId, tipo_descarga: "Directo", creado_por: "test",
    });
    const viajes = await prisma.viajes.findMany({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
      orderBy: { id: "asc" },
    });
    expect(viajes.length).toBeGreaterThanOrEqual(2);
    // Salida→llegada real: 30 min en uno y 50 min en otro → promedio 40.
    const base = new Date("2026-08-01T08:00:00");
    await prisma.viajes.update({
      where: { id: viajes[0].id },
      data: { ts_salida_real: base, ts_llegada_real: new Date(base.getTime() + 30 * 60000) },
    });
    await prisma.viajes.update({
      where: { id: viajes[1].id },
      data: { ts_salida_real: base, ts_llegada_real: new Date(base.getTime() + 50 * 60000) },
    });

    const cambio = await recalcularTransportePromedioCliente(clienteId);
    expect(cambio?.anterior).toBe(20);
    expect(cambio?.nuevo).toBe(40);
    const cli = await prisma.clientes.findUniqueOrThrow({ where: { id: clienteId } });
    expect(cli.tiempo_viaje_referencia_min).toBe(40);
    expect(cli.tiempo_regreso_referencia_min).toBe(40); // espejo ida = regreso
  });
});

describe("frecuencia entre camiones — reclutar flota + cadencia constante", () => {
  // Caso REAL que motivó el arreglo: 200 m³, frecuencia 15 min, 2 plantas (Santa
  // Marta), 6 mixers de 11 + 6 de 9. Antes solo usaba los 6 de 11 y daba 15/18
  // (promedio 16.5). Ahora recluta mixers de otra capacidad y sostiene 15 constante.
  it("200 m³ / freq 15 / 2 plantas: recluta ≥7 mixers y las llegadas quedan a 15 min constantes", async () => {
    const plantel = await prisma.planteles.create({
      data: {
        nombre: "SM-Frec", zona: "Norte", capacidad_dosificacion_m3h: 45,
        plantas: { create: [{ nombre: "STALO", capacidad_m3h: 45 }, { nombre: "SANY", capacidad_m3h: 45 }] },
      },
      include: { plantas: true },
    });
    await prisma.planteles.update({ where: { id: plantel.id }, data: { hub_id: plantel.id } });
    const stalo = plantel.plantas.find((p) => p.nombre === "STALO")!;
    await crearMixers(plantel.id, [[11, 6], [9, 6]]);
    const clienteId = await crearCliente(true, 30, 30);
    const disenoId = await crearDiseno();

    const r = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 200, hora_solicitada: DIA,
      plantel_id: plantel.id, planta_id: stalo.id, tipo_descarga: "Directo", creado_por: "test",
      frecuencia_entre_camiones_min: 15, usar_ambas_plantas: true,
    });

    expect(r.volumenSinCubrir).toBe(0);
    const viajes = await prisma.viajes.findMany({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
      select: { mixer_id: true, hora_llegada_proyecto: true },
    });
    // Recluta mixers más allá de los 6 de 11 m³ (usa también los de 9).
    const distintos = new Set(viajes.map((v) => v.mixer_id)).size;
    expect(distintos).toBeGreaterThanOrEqual(7);
    // Cadencia de LLEGADAS constante a 15 min (no 15/18).
    const llegadas = viajes
      .map((v) => v.hora_llegada_proyecto!.getTime())
      .sort((a, b) => a - b);
    for (let i = 1; i < llegadas.length; i++) {
      const gap = Math.round((llegadas[i] - llegadas[i - 1]) / 60000);
      expect(gap).toBe(15);
    }
  });

  // Cuando la frecuencia pedida NO es alcanzable ni con toda la flota, el análisis
  // lo detecta con números correctos y el pedido IGUAL se programa (no bloquea).
  it("freq inalcanzable: el análisis avisa (alcanzable=false) y el pedido igual se programa", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "Escaso", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 6]]);
    const clienteId = await crearCliente(true, 30, 30);
    const disenoId = await crearDiseno();

    // Frecuencia agresiva de 5 min con una sola planta: imposible (la carga en planta
    // ya tarda ~20 min por viaje). El análisis debe decir alcanzable=false.
    const analisis = await analizarFrecuenciaPedido({
      plantelId, plantaId, volumenTotal: 120, frecuenciaMin: 5,
      tipoDescarga: "Directo", clienteId, usarAmbasPlantas: false, dia: DIA,
    });
    expect(analisis.alcanzable).toBe(false);
    expect(analisis.mixersDisponibles).toBe(6);
    expect(analisis.frecuenciaAlcanzableMin).toBeGreaterThan(5);
    expect(analisis.ciclo.cicloMin).toBeGreaterThan(0);

    // Pese al aviso, programar NO se bloquea: se cubre el volumen a la cadencia real.
    const r = await programarPedido({
      cliente_id: clienteId, diseno_id: disenoId, volumen_total_m3: 120, hora_solicitada: DIA,
      plantel_id: plantelId, planta_id: plantaId, tipo_descarga: "Directo", creado_por: "test",
      frecuencia_entre_camiones_min: 5,
    });
    expect(r.volumenSinCubrir).toBe(0);
    const n = await prisma.viajes.count({ where: { pedido_id: r.pedidoId, mixer_id: { not: null } } });
    expect(n).toBeGreaterThan(0);
  });
});
