// Pruebas de INTEGRACIÓN del motor contra la BD de prueba (test.db).
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  avanzarEstadoViaje,
  cancelarPedido,
  confirmarRefuerzo,
  corregirHoraReal,
  detectarAlertasMargen,
  editarVolumenViaje,
  modificarPedido,
  programarPedido,
  reasignarMixer,
  reordenarPedidoDia,
  sugerirHoraDisponible,
} from "@/lib/motor/asignacion";
import { calcularAlcance, filtroPedidoPorZona } from "@/lib/auth/acceso";
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

  it("reasignarMixer rechaza asignar un mixer ya ocupado en horario traslapado", async () => {
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

    const r1 = await programarPedido(base);
    const r2 = await programarPedido(base);
    const mixerDe1 = r1.viajes.find((v) => v.mixerId != null)!.mixerId!;
    const viaje2 = r2.viajes.find((v) => v.mixerId != null)!;
    expect(viaje2.mixerId).not.toBe(mixerDe1);

    // Intentar mover el viaje del pedido 2 al mixer del pedido 1 (traslapado).
    const res = await reasignarMixer(viaje2.id, mixerDe1);
    expect(res.ok).toBe(false);
    expect(res.motivo).toMatch(/traslapa/i);
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
    // hora_solicitada es la LLEGADA deseada. El segundo pedido llega DESPUÉS del
    // primero (que llega a la hora de inicio de jornada = 08:00).
    const antes = await prisma.viajes.findUniqueOrThrow({ where: { id: viaje2.id } });
    expect(antes.hora_llegada_proyecto!.getTime()).toBeGreaterThan(DIA.getTime());

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
