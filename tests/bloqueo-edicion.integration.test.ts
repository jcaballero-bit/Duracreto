// Bloqueo horario en el LÍMITE REAL de la server action: comprueba que una escritura
// de programación se rechaza aunque se invoque directamente (no basta con ocultar
// botones), que el Administrador nunca queda bloqueado, que el rechazo queda en
// `bitacora_auditoria`, y —lo más importante— que el Despacho en vivo NO se detiene.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";
import { CLAVE_BLOQUEO_ACTIVO, CLAVE_BLOQUEO_HORA } from "@/lib/programacion/bloqueo";
import { agregarViajeManual } from "@/lib/motor/asignacion";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

// Sesión simulada: el rol se cambia por prueba con `sesionDe`.
let rolActual: "Administrador" | "Programador" | "Despachador" | "JefePlanta" = "Programador";
// Jefe de Planta: se le asignan TODOS los planteles del escenario (M2M).
let plantelesJefe: number[] = [];
const sesionDe = (rol: typeof rolActual) => {
  rolActual = rol;
};

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "u1", name: "Usuario Prueba", email: "u1@test.com" } }),
}));
vi.mock("@/lib/auth/guard", () => ({
  alcanceActual: async () => calcularAlcance([rolActual], "Norte", null, null, plantelesJefe),
  requerirAcceso: async () => calcularAlcance([rolActual], "Norte", null, null, plantelesJefe),
  exigirAdmin: async () => ({ ok: true, userId: "u1" }),
  exigirGestionFlota: async () => ({ ok: true, userId: "u1" }),
  requerirPasswordAlDia: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Se importa DESPUÉS de declarar los mocks.
const { editarViajeManualAction, avanzarEstadoAction } = await import("@/app/actions");

/** Config del bloqueo: corte relativo a la hora actual del reloj. */
async function configurarBloqueo(activo: boolean, minutosDesdeAhora: number) {
  const ahora = new Date();
  const corte = ahora.getHours() * 60 + ahora.getMinutes() + minutosDesdeAhora;
  for (const [clave, valor] of [
    [CLAVE_BLOQUEO_ACTIVO, activo ? 1 : 0],
    [CLAVE_BLOQUEO_HORA, Math.max(0, Math.min(23 * 60 + 59, corte))],
  ] as const) {
    await prisma.configuracion.upsert({
      where: { clave },
      update: { valor_int: valor },
      create: { clave, valor_int: valor },
    });
  }
}

async function escenario() {
  const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Bloqueo", zona: "Norte", esHub: true });
  await crearMixers(plantelId, [[11, 2]]);
  const clienteId = await crearCliente(true, 30, 30);
  const disenoId = await crearDiseno();
  const mixers = await prisma.mixers.findMany({ where: { plantel_base_id: plantelId }, orderBy: { id: "asc" } });
  const hoy = new Date();
  hoy.setHours(8, 0, 0, 0);
  const { viajeId } = await agregarViajeManual({
    cliente_id: clienteId,
    diseno_id: disenoId,
    plantel_id: plantelId,
    planta_id: plantaId,
    mixer_id: mixers[0].id,
    volumen: 9,
    inicio_carga: hoy,
    tipo_descarga: "Canal directo",
    creado_por: "test",
  });
  return { viajeId, horaCarga: hoy };
}

const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

beforeEach(async () => {
  await limpiarBD();
  await prisma.configuracion.deleteMany({});
  plantelesJefe = [];
});

describe("bloqueo horario en la server action", () => {
  it("(f) rechaza la edición de un Programador pasado el corte, aunque llame directo", async () => {
    const s = await escenario();
    sesionDe("Programador");
    await configurarBloqueo(true, -30); // el corte fue hace 30 min

    const nueva = new Date(s.horaCarga.getTime() + 60 * 60_000);
    const res = await editarViajeManualAction(s.viajeId, { horaCargaLocal: localInput(nueva) });

    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain("bloqueada");
    // Y el viaje NO se movió.
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: s.viajeId } });
    expect(v.hora_inicio_carga!.getTime()).toBe(s.horaCarga.getTime());
  });

  it("(f) el intento rechazado queda registrado en la bitácora", async () => {
    const s = await escenario();
    sesionDe("Programador");
    await configurarBloqueo(true, -30);
    await editarViajeManualAction(s.viajeId, { horaCargaLocal: localInput(s.horaCarga) });

    const registros = await prisma.bitacora_auditoria.findMany({
      where: { campo_modificado: "bloqueo_horario" },
    });
    expect(registros.length).toBeGreaterThan(0);
    expect(registros[0].valor_nuevo).toContain("Editar viaje");
    expect(registros[0].usuario).toBe("Usuario Prueba");
  });

  it("(f) el Administrador SÍ puede editar después del corte", async () => {
    const s = await escenario();
    sesionDe("Administrador");
    await configurarBloqueo(true, -30);

    const nueva = new Date(s.horaCarga.getTime() + 60 * 60_000);
    const res = await editarViajeManualAction(s.viajeId, { horaCargaLocal: localInput(nueva) });

    expect(res.ok).toBe(true);
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: s.viajeId } });
    expect(v.hora_inicio_carga!.getTime()).toBe(nueva.getTime());
  });

  it("(f) el DESPACHO EN VIVO no se detiene: el despachador avanza estados con el bloqueo activo", async () => {
    const s = await escenario();
    sesionDe("Despachador");
    await configurarBloqueo(true, -30);

    // Marcar el inicio de carga del mixer a las 5 de la tarde no puede fallar nunca.
    const res = await avanzarEstadoAction(s.viajeId, "En carga");
    expect(res.ok).toBe(true);
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: s.viajeId } });
    expect(v.estado).toBe("En carga");
    expect(v.ts_inicio_carga_real).not.toBeNull();
  });

  it("(g) con el bloqueo desactivado, el Programador edita con normalidad", async () => {
    const s = await escenario();
    sesionDe("Programador");
    await configurarBloqueo(false, -30);

    const nueva = new Date(s.horaCarga.getTime() + 30 * 60_000);
    const res = await editarViajeManualAction(s.viajeId, { horaCargaLocal: localInput(nueva) });

    expect(res.ok).toBe(true);
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: s.viajeId } });
    expect(v.hora_inicio_carga!.getTime()).toBe(nueva.getTime());
  });

  it("con el bloqueo activo pero ANTES del corte, el Programador edita con normalidad", async () => {
    const s = await escenario();
    sesionDe("Programador");
    await configurarBloqueo(true, 60); // el corte es dentro de 1 hora

    const nueva = new Date(s.horaCarga.getTime() + 30 * 60_000);
    const res = await editarViajeManualAction(s.viajeId, { horaCargaLocal: localInput(nueva) });
    expect(res.ok).toBe(true);
  });
});

describe("congelamiento del DPCR-08 sujeto al interruptor", () => {
  // Un pedido para MAÑANA: su cierre seria HOY a la hora de corte, asi que pasada esa
  // hora la regla vieja (4:00 p.m. fijas) bloqueaba al Jefe de Planta aunque el
  // interruptor estuviera apagado. `eliminarPedidoAction` pasa por el mismo guard
  // (`autorizarCambioPrograma`) que crear y cancelar.
  async function pedidoDeManana() {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Corte", zona: "Norte", esHub: true });
    await crearMixers(plantelId, [[11, 2]]);
    const clienteId = await crearCliente(true, 30, 30);
    const disenoId = await crearDiseno();
    const mixers = await prisma.mixers.findMany({ where: { plantel_base_id: plantelId }, orderBy: { id: "asc" } });
    plantelesJefe = [plantelId];

    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    manana.setHours(9, 0, 0, 0);
    const { viajeId } = await agregarViajeManual({
      cliente_id: clienteId,
      diseno_id: disenoId,
      plantel_id: plantelId,
      planta_id: plantaId,
      mixer_id: mixers[0].id,
      volumen: 9,
      inicio_carga: manana,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId }, select: { pedido_id: true } });
    return v.pedido_id;
  }

  it("con el bloqueo DESACTIVADO, el Jefe de Planta cambia el programa aunque pasen de las 4 p.m.", async () => {
    const pedidoId = await pedidoDeManana();
    sesionDe("JefePlanta");
    await configurarBloqueo(false, -600); // apagado; "el corte" quedo muy atras

    const { eliminarPedidoAction } = await import("@/app/actions");
    const res = await eliminarPedidoAction(pedidoId);
    expect(res.ok, res.mensaje ?? "").toBe(true);
  });

  it("con el bloqueo ACTIVADO y el corte pasado, el Jefe de Planta ya no puede", async () => {
    const pedidoId = await pedidoDeManana();
    sesionDe("JefePlanta");
    await configurarBloqueo(true, -30);

    const { eliminarPedidoAction } = await import("@/app/actions");
    const res = await eliminarPedidoAction(pedidoId);
    expect(res.ok).toBe(false);
    expect(res.mensaje).toMatch(/cerrado|bloquead/i);
  });

  it("el Administrador puede aunque el bloqueo este activo y el corte pasado", async () => {
    const pedidoId = await pedidoDeManana();
    sesionDe("Administrador");
    await configurarBloqueo(true, -30);

    const { eliminarPedidoAction } = await import("@/app/actions");
    const res = await eliminarPedidoAction(pedidoId);
    expect(res.ok, res.mensaje ?? "").toBe(true);
  });
});
