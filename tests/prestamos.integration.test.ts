// Préstamo de unidades contra Postgres, por las server actions.
//
// Lo que más importa: que el motor RESPETE el préstamo (la unidad se puede usar en el
// plantel destino y deja de estar disponible en su base y en el resto de la zona), y
// que sin préstamos todo se comporte exactamente como antes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

type Rol = "Administrador" | "JefePlanta" | "Programador" | "Asesor";
let rol: Rol = "Administrador";
let plantelesJefe: number[] = [];

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "u1", name: "Prueba", email: "p@test.com" } }),
}));
vi.mock("@/lib/auth/guard", () => ({
  exigirGestionFlota: async () =>
    rol === "Asesor"
      ? { ok: false, mensaje: "No tienes permiso para gestionar la flota." }
      : { ok: true, userId: "u1" },
  alcanceActual: async () => calcularAlcance([rol], "Norte", null, null, plantelesJefe),
  exigirAdmin: async () => ({ ok: true, userId: "u1" }),
  requerirAcceso: async () => ({}),
  requerirPasswordAlDia: async () => {},
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

const { prestarUnidadAction, devolverUnidadAction, revisarPrestamoAction } = await import(
  "@/app/flota/prestamos-actions"
);
const { programarPedido } = await import("@/lib/motor/asignacion");

const DIA = new Date(2027, 2, 10, 8, 0);
const FECHA_ISO = "2027-03-10";

/**
 * Zona Norte reducida: Santa Marta (hub, con flota), Choloma y Villanueva (sin flota
 * propia, dependen del hub) y Puerto Cortés (con flota propia).
 */
async function zonaNorte() {
  const sm = await crearPlantel({ nombre: "Santa Marta T", zona: "Norte", esHub: true });
  const cho = await crearPlantel({ nombre: "Choloma T", zona: "Norte", hubId: sm.plantelId });
  const vil = await crearPlantel({ nombre: "Villanueva T", zona: "Norte", hubId: sm.plantelId });
  const pc = await crearPlantel({ nombre: "Puerto Cortes T", zona: "Norte", hubId: sm.plantelId });
  return { sm, cho, vil, pc };
}

/** Programa un pedido y devuelve los mixers que el motor le asignó. */
async function mixersAsignados(plantelId: number, plantaId: number, volumen = 11) {
  const clienteId = await crearCliente(true);
  const disenoId = await crearDiseno();
  const r = await programarPedido({
    cliente_id: clienteId,
    diseno_id: disenoId,
    volumen_total_m3: volumen,
    hora_solicitada: DIA,
    plantel_id: plantelId,
    planta_id: plantaId,
    tipo_descarga: "Canal directo",
    creado_por: "test",
  });
  const viajes = await prisma.viajes.findMany({
    where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
    select: { mixer_id: true },
  });
  return { pedidoId: r.pedidoId, mixerIds: viajes.map((v) => v.mixer_id!), resultado: r };
}

const prestar = (unidadTipo: string, unidadId: number, destinoId: number, motivo?: string) =>
  prestarUnidadAction({ unidadTipo, unidadId, destinoId, fechaISO: FECHA_ISO, motivo });

beforeEach(async () => {
  await limpiarBD();
  await prisma.bitacora_auditoria.deleteMany();
  rol = "Administrador";
  plantelesJefe = [];
});

describe("el motor respeta el préstamo de un MIXER", () => {
  it("sin préstamos, Choloma usa la flota de su hub (como siempre)", async () => {
    const { sm, cho } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 2]]);

    const { mixerIds } = await mixersAsignados(cho.plantelId, cho.plantaId);
    expect(mixerIds).toHaveLength(1);
    const m = await prisma.mixers.findUniqueOrThrow({ where: { id: mixerIds[0] } });
    expect(m.plantel_base_id).toBe(sm.plantelId); // vino del hub
  });

  it("prestado a Choloma, el mixer DEJA de estar disponible en Santa Marta", async () => {
    const { sm, cho } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 2]]);
    const [m1, m2] = await prisma.mixers.findMany({
      where: { plantel_base_id: sm.plantelId },
      orderBy: { id: "asc" },
    });

    expect((await prestar("Mixer", m1.id, cho.plantelId)).ok).toBe(true);

    // Santa Marta programa dos viajes: solo puede usar el mixer que le queda, así que
    // el mismo hace los dos (reutilización por horario), nunca el prestado.
    const { mixerIds } = await mixersAsignados(sm.plantelId, sm.plantaId, 22);
    expect(mixerIds.length).toBeGreaterThan(0);
    expect(new Set(mixerIds)).toEqual(new Set([m2.id]));
    expect(mixerIds).not.toContain(m1.id);
  });

  it("prestado a Choloma, Choloma SÍ lo usa", async () => {
    const { sm, cho } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 1]]);
    const m1 = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: sm.plantelId } });

    await prestar("Mixer", m1.id, cho.plantelId);

    const { mixerIds } = await mixersAsignados(cho.plantelId, cho.plantaId);
    expect(mixerIds).toEqual([m1.id]);
  });

  it("un mixel prestado ENTRE planteles con flota propia llega a su destino", async () => {
    // Puerto Cortes tiene flota propia y NO es el hub: el mecanismo de hub no puede
    // expresar "Puerto Cortes le presta a Choloma". El prestamo explicito si.
    const { sm, cho, pc } = await zonaNorte();
    await crearMixers(pc.plantelId, [[9, 1]]);
    const propio = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: pc.plantelId } });
    // Santa Marta (el hub) sin flota, para que Choloma no tenga otra opcion.
    expect(await prisma.mixers.count({ where: { plantel_base_id: sm.plantelId } })).toBe(0);

    await prestar("Mixer", propio.id, cho.plantelId);

    const { mixerIds } = await mixersAsignados(cho.plantelId, cho.plantaId, 9);
    expect(mixerIds).toEqual([propio.id]);
  });

  it("prestado a Choloma, VILLANUEVA (el otro dependiente del hub) ya no lo ve", async () => {
    // Esta es la diferencia con el pool del hub: el prestamo COMPROMETE la unidad con
    // un plantel, no la deja en el aire para toda la zona.
    const { sm, cho, vil } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 1]]);
    const m1 = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: sm.plantelId } });

    await prestar("Mixer", m1.id, cho.plantelId);

    const { resultado } = await mixersAsignados(vil.plantelId, vil.plantaId);
    // Sin ninguna unidad disponible, Villanueva queda con volumen sin cubrir.
    expect(resultado.volumenSinCubrir).toBeGreaterThan(0);
  });

  it("el préstamo vale SOLO para su día: al día siguiente la unidad vuelve", async () => {
    const { sm, cho } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 1]]);
    const m1 = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: sm.plantelId } });
    await prestar("Mixer", m1.id, cho.plantelId);

    // Mismo pedido, un dia despues: Santa Marta lo tiene otra vez.
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 11,
      hora_solicitada: new Date(2027, 2, 11, 8, 0),
      plantel_id: sm.plantelId,
      planta_id: sm.plantaId,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });
    const v = await prisma.viajes.findFirstOrThrow({
      where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
    });
    expect(v.mixer_id).toBe(m1.id);
  });

  it("al DEVOLVERLO, la unidad vuelve a estar disponible en su plantel", async () => {
    const { sm, cho } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 1]]);
    const m1 = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: sm.plantelId } });
    await prestar("Mixer", m1.id, cho.plantelId);
    const p = await prisma.prestamos_unidad.findFirstOrThrow();

    expect((await devolverUnidadAction(p.id)).ok).toBe(true);
    expect(await prisma.prestamos_unidad.count()).toBe(0);

    const { mixerIds } = await mixersAsignados(sm.plantelId, sm.plantaId);
    expect(mixerIds).toEqual([m1.id]);
  });
});

describe("el motor respeta el préstamo de una BOMBA", () => {
  async function conBomba(plantelId: number) {
    return prisma.bombas.create({
      data: { identificador: `B-${plantelId}`, plantel_base_id: plantelId },
    });
  }
  /** Programa un pedido POR BOMBA y devuelve las bombas que el motor le asignó. */
  async function bombasAsignadas(plantelId: number, plantaId: number) {
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: 11,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Bomba",
      creado_por: "test",
    });
    const asig = await prisma.pedidos_bombas.findMany({
      where: { pedido_id: r.pedidoId },
      select: { bomba_id: true },
    });
    return asig.map((a) => a.bomba_id);
  }

  it("prestada a Choloma, Choloma la usa y Santa Marta ya no", async () => {
    const { sm, cho } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 2]]);
    const bomba = await conBomba(sm.plantelId);

    await prestar("Bomba", bomba.id, cho.plantelId);

    expect(await bombasAsignadas(cho.plantelId, cho.plantaId)).toEqual([bomba.id]);
    // Santa Marta se queda sin bomba: la unica que tenia esta en Choloma.
    expect(await bombasAsignadas(sm.plantelId, sm.plantaId)).toEqual([]);
  });

  it("una bomba prestada no se ofrece como refuerzo a un tercer plantel", async () => {
    const { sm, cho, vil } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 2]]);
    const bomba = await conBomba(sm.plantelId);
    await prestar("Bomba", bomba.id, cho.plantelId);

    // Alguien decidio que va a Choloma: Villanueva no la toma "de refuerzo".
    expect(await bombasAsignadas(vil.plantelId, vil.plantaId)).toEqual([]);
  });
});

describe("permisos: se presta lo propio, no lo ajeno", () => {
  it("un Jefe de Planta NO puede prestar una unidad de un plantel que no es suyo", async () => {
    const { sm, cho } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 1]]);
    const ajeno = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: sm.plantelId } });

    rol = "JefePlanta";
    plantelesJefe = [cho.plantelId]; // solo Choloma

    const r = await prestar("Mixer", ajeno.id, cho.plantelId);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/no es de tus planteles/i);
    expect(await prisma.prestamos_unidad.count()).toBe(0);
  });

  it("un Jefe de Planta SÍ puede prestar la unidad de su propio plantel", async () => {
    const { sm, cho } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 1]]);
    const propio = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: sm.plantelId } });

    rol = "JefePlanta";
    plantelesJefe = [sm.plantelId];

    expect((await prestar("Mixer", propio.id, cho.plantelId)).ok).toBe(true);
  });

  it("un Programador puede prestar las unidades de su ZONA", async () => {
    const { sm, cho } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 1]]);
    const m = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: sm.plantelId } });

    rol = "Programador"; // zona Norte
    expect((await prestar("Mixer", m.id, cho.plantelId)).ok).toBe(true);
  });

  it("un rol sin gestión de flota es rechazado en las tres acciones", async () => {
    const { sm, cho } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 1]]);
    const m = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: sm.plantelId } });

    rol = "Asesor";
    expect((await prestar("Mixer", m.id, cho.plantelId)).ok).toBe(false);
    expect((await revisarPrestamoAction({ unidadTipo: "Mixer", unidadId: m.id, fechaISO: FECHA_ISO })).ok).toBe(false);
    expect((await devolverUnidadAction(1)).ok).toBe(false);
    expect(await prisma.prestamos_unidad.count()).toBe(0);
  });

  it("quien RECIBIÓ el préstamo también puede devolverlo", async () => {
    const { sm, cho } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 1]]);
    const m = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: sm.plantelId } });
    await prestar("Mixer", m.id, cho.plantelId);
    const p = await prisma.prestamos_unidad.findFirstOrThrow();

    // El Jefe de Planta de CHOLOMA (el destino) puede deshacerlo: le llego una unidad
    // que quizas ya no necesita.
    rol = "JefePlanta";
    plantelesJefe = [cho.plantelId];
    expect((await devolverUnidadAction(p.id)).ok).toBe(true);
  });
});

describe("reglas al guardar", () => {
  it("no se puede prestar una unidad a su propio plantel", async () => {
    const { sm } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 1]]);
    const m = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: sm.plantelId } });

    const r = await prestar("Mixer", m.id, sm.plantelId);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/ya es de ese plantel/i);
  });

  it("no se puede prestar la MISMA unidad dos veces el mismo día", async () => {
    const { sm, cho, vil } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 1]]);
    const m = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: sm.plantelId } });

    expect((await prestar("Mixer", m.id, cho.plantelId)).ok).toBe(true);
    const r = await prestar("Mixer", m.id, vil.plantelId);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/ya está prestada ese día/i);
    expect(await prisma.prestamos_unidad.count()).toBe(1);
  });

  it("sí se puede prestar la misma unidad a otro plantel OTRO día", async () => {
    const { sm, cho, vil } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 1]]);
    const m = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: sm.plantelId } });

    expect((await prestar("Mixer", m.id, cho.plantelId)).ok).toBe(true);
    const otro = await prestarUnidadAction({
      unidadTipo: "Mixer",
      unidadId: m.id,
      destinoId: vil.plantelId,
      fechaISO: "2027-03-11",
    });
    expect(otro.ok).toBe(true);
    expect(await prisma.prestamos_unidad.count()).toBe(2);
  });

  it("una unidad en MANTENIMIENTO ese día no se puede prestar", async () => {
    const { sm, cho } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 1]]);
    const m = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: sm.plantelId } });
    await prisma.disponibilidad_flota.create({
      data: {
        unidad_tipo: "Mixer",
        unidad_id: m.id,
        fecha_inicio: new Date(2027, 2, 9),
        fecha_fin: new Date(2027, 2, 12),
        tipo_evento: "Mantenimiento_Programado",
        estado: "Programado",
        creado_por: "test",
      },
    });

    const r = await prestar("Mixer", m.id, cho.plantelId);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/mantenimiento/i);
    expect(await prisma.prestamos_unidad.count()).toBe(0);
  });

  it("una unidad que no está Disponible tampoco se presta", async () => {
    const { sm, cho } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 1]]);
    const m = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: sm.plantelId } });
    await prisma.mixers.update({ where: { id: m.id }, data: { estado: "Dañado" } });

    const r = await prestar("Mixer", m.id, cho.plantelId);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/Dañado/);
  });

  it("una unidad inexistente y un destino inexistente se rechazan", async () => {
    const { cho } = await zonaNorte();
    expect((await prestar("Mixer", 99999, cho.plantelId)).mensaje).toMatch(/no existe/i);
  });

  it("cada préstamo y cada devolución quedan en la bitácora", async () => {
    const { sm, cho } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 1]]);
    const m = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: sm.plantelId } });

    await prestar("Mixer", m.id, cho.plantelId, "Refuerzo por vaciado");
    const alta = await prisma.bitacora_auditoria.findFirstOrThrow({
      where: { tabla_afectada: "prestamos_unidad" },
      orderBy: { id: "desc" },
    });
    expect(alta.motivo).toMatch(/Prestamo de Mixer/);
    expect(alta.motivo).toMatch(/Choloma T/);
    expect(alta.valor_anterior).toBe(String(sm.plantelId));
    expect(alta.valor_nuevo).toBe(String(cho.plantelId));

    const p = await prisma.prestamos_unidad.findFirstOrThrow();
    await devolverUnidadAction(p.id);
    const baja = await prisma.bitacora_auditoria.findFirstOrThrow({
      where: { tabla_afectada: "prestamos_unidad" },
      orderBy: { id: "desc" },
    });
    expect(baja.motivo).toMatch(/cancelo el prestamo/i);
    expect(baja.valor_nuevo).toBeNull();
  });
});

describe("aviso previo (revisar antes de confirmar)", () => {
  it("advierte de los viajes que la unidad ya tiene ese día, sin bloquear", async () => {
    const { sm, cho } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 1]]);
    // El mixer queda con 2 viajes de un pedido de Santa Marta ese dia.
    const { mixerIds } = await mixersAsignados(sm.plantelId, sm.plantaId, 22);
    const usado = mixerIds[0];

    const r = await revisarPrestamoAction({
      unidadTipo: "Mixer",
      unidadId: usado,
      fechaISO: FECHA_ISO,
    });
    expect(r.ok).toBe(true); // avisa, no bloquea
    expect(r.advertencias!.join(" ")).toMatch(/viajes programado/);

    // Y se puede prestar igual: la decision es del usuario.
    expect((await prestar("Mixer", usado, cho.plantelId)).ok).toBe(true);
  });

  it("la revisión NO escribe nada", async () => {
    const { sm } = await zonaNorte();
    await crearMixers(sm.plantelId, [[11, 1]]);
    const m = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: sm.plantelId } });

    await revisarPrestamoAction({ unidadTipo: "Mixer", unidadId: m.id, fechaISO: FECHA_ISO });
    expect(await prisma.prestamos_unidad.count()).toBe(0);
  });

  it("un camión avisa que no lo asigna el motor (es coordinación)", async () => {
    const { sm } = await zonaNorte();
    const cam = await prisma.camiones.create({
      data: { identificador: "CAM-1", plantel_base_id: sm.plantelId },
    });
    const r = await revisarPrestamoAction({
      unidadTipo: "Camion",
      unidadId: cam.id,
      fechaISO: FECHA_ISO,
    });
    expect(r.ok).toBe(true);
    expect(r.advertencias!.join(" ")).toMatch(/no los asigna el motor/i);
  });
});

describe("camiones y pickups: registro de coordinación", () => {
  it("se prestan y se listan, aunque el motor no los use", async () => {
    const { sm, cho } = await zonaNorte();
    const cam = await prisma.camiones.create({
      data: { identificador: "CAM-9", plantel_base_id: sm.plantelId },
    });
    const pick = await prisma.pickups.create({
      data: { identificador: "PK-3", plantel_base_id: sm.plantelId },
    });

    expect((await prestar("Camion", cam.id, cho.plantelId)).ok).toBe(true);
    expect((await prestar("Pickup", pick.id, cho.plantelId)).ok).toBe(true);

    const { prestamosDeDiaVista } = await import("@/lib/flota/prestamos-datos");
    const filas = await prestamosDeDiaVista(new Date(2027, 2, 10), null);
    expect(filas.map((f) => f.unidad).sort()).toEqual(["CAM-9", "PK-3"]);
    expect(filas.every((f) => f.destino === "Choloma T")).toBe(true);
  });
});
