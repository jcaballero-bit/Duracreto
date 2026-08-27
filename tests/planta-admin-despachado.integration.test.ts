// El Administrador puede CORREGIR la planta dosificadora de un viaje que ya salió.
//
// El caso real: el mixer cargó en SANY pero el registro quedó en STALO, y el camión ya
// se fue (o ya volvió). Para todos los demás roles el cambio de planta se cierra en
// cuanto el viaje inicia su carga —a esa altura ya no se está repartiendo trabajo, se
// está describiendo lo que pasó—; el Admin sí puede ajustarlo, con el cambio en la
// bitácora identificado como corrección.
//
// Se prueba en la server action, no en el motor, porque el privilegio sale de la SESIÓN:
// ocultar el botón en la pantalla no sería una restricción real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";
import { agregarViajeManual, avanzarEstadoViaje } from "@/lib/motor/asignacion";
import { SECUENCIA_ESTADOS_VIAJE } from "@/lib/motor/config";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

let rolActual: "Administrador" | "Despachador" = "Despachador";

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "u1", name: "Usuario Prueba", email: "u1@test.com" } }),
}));
vi.mock("@/lib/auth/guard", () => ({
  alcanceActual: async () => calcularAlcance([rolActual], "Norte", null, null, []),
  requerirAcceso: async () => calcularAlcance([rolActual], "Norte", null, null, []),
  exigirAdmin: async () => ({ ok: true, userId: "u1" }),
  exigirGestionFlota: async () => ({ ok: true, userId: "u1" }),
  requerirPasswordAlDia: async () => {},
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

const { cambiarPlantaViajeAction } = await import("@/app/actions");

/**
 * Un plantel de DOS plantas (como Santa Marta o Tegucigalpa) con un viaje de hoy
 * avanzado hasta el estado pedido. `estadoFinal: null` lo deja sin arrancar.
 */
async function escenario(estadoFinal: string | null) {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "SM Planta",
    zona: "Norte",
    esHub: true,
  });
  const segunda = await prisma.plantas.create({
    data: { plantel_id: plantelId, nombre: "SM Planta P2", capacidad_m3h: 50 },
  });
  await crearMixers(plantelId, [[11, 1]]);
  const clienteId = await crearCliente(true, 30, 30);
  const disenoId = await crearDiseno();
  const mixer = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: plantelId } });
  const hoy = new Date();
  hoy.setHours(8, 0, 0, 0);
  const { viajeId } = await agregarViajeManual({
    cliente_id: clienteId,
    diseno_id: disenoId,
    plantel_id: plantelId,
    planta_id: plantaId,
    mixer_id: mixer.id,
    volumen: 9,
    inicio_carga: hoy,
    tipo_descarga: "Canal directo",
    creado_por: "test",
  });
  if (estadoFinal) {
    for (const estado of SECUENCIA_ESTADOS_VIAJE) {
      await avanzarEstadoViaje(viajeId, estado);
      if (estado === estadoFinal) break;
    }
  }
  return { viajeId, plantelId, plantaId, segundaId: segunda.id };
}

beforeEach(async () => {
  await limpiarBD();
  await prisma.bitacora_auditoria.deleteMany();
  rolActual = "Despachador";
});

describe("corregir la planta de un viaje ya despachado", () => {
  it("el Administrador la corrige aunque el viaje esté Completado", async () => {
    const { viajeId, segundaId } = await escenario("Completado");
    rolActual = "Administrador";

    const res = await cambiarPlantaViajeAction(viajeId, segundaId);
    expect(res.ok).toBe(true);
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });
    expect(v.planta_id).toBe(segundaId);
    // Solo la planta: el estado, las horas reales y el volumen quedan intactos.
    expect(v.estado).toBe("Completado");
    expect(v.ts_inicio_carga_real).not.toBeNull();
    expect(v.ts_regreso_real).not.toBeNull();
    expect(v.volumen_asignado_m3).toBe(9);
  });

  it("también la corrige con el camión en ruta", async () => {
    const { viajeId, segundaId } = await escenario("En ruta");
    rolActual = "Administrador";
    expect((await cambiarPlantaViajeAction(viajeId, segundaId)).ok).toBe(true);
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });
    expect(v.planta_id).toBe(segundaId);
    expect(v.estado).toBe("En ruta");
  });

  it("NO reescribe las horas programadas del viaje (línea base del programa)", async () => {
    const { viajeId, segundaId } = await escenario("Completado");
    const antes = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });
    rolActual = "Administrador";
    await cambiarPlantaViajeAction(viajeId, segundaId);
    const despues = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });

    expect(despues.hora_inicio_carga).toEqual(antes.hora_inicio_carga);
    expect(despues.hora_fin_carga).toEqual(antes.hora_fin_carga);
    expect(despues.hora_salida_planta).toEqual(antes.hora_salida_planta);
    expect(despues.hora_llegada_proyecto).toEqual(antes.hora_llegada_proyecto);
    expect(despues.hora_regreso_planta).toEqual(antes.hora_regreso_planta);
  });

  it("un Despachador sigue sin poder: el viaje ya inició su carga", async () => {
    const { viajeId, segundaId } = await escenario("En carga");
    rolActual = "Despachador";
    const res = await cambiarPlantaViajeAction(viajeId, segundaId);
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain("ya inició su carga");
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });
    expect(v.planta_id).not.toBe(segundaId); // no se movió
  });

  it("un Despachador SÍ puede mientras el viaje no ha arrancado", async () => {
    const { viajeId, segundaId } = await escenario(null);
    rolActual = "Despachador";
    expect((await cambiarPlantaViajeAction(viajeId, segundaId)).ok).toBe(true);
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });
    expect(v.planta_id).toBe(segundaId);
  });

  it("ni el Admin puede mover el viaje a una planta de OTRO plantel", async () => {
    const { viajeId } = await escenario("Completado");
    const otro = await crearPlantel({ nombre: "CHO Planta", zona: "Norte" });
    rolActual = "Administrador";
    const res = await cambiarPlantaViajeAction(viajeId, otro.plantaId);
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain("no pertenece al plantel");
  });

  it("un viaje CANCELADO no se mueve, ni siendo Admin", async () => {
    const { viajeId, segundaId } = await escenario(null);
    await prisma.viajes.update({ where: { id: viajeId }, data: { estado: "Cancelado" } });
    rolActual = "Administrador";
    const res = await cambiarPlantaViajeAction(viajeId, segundaId);
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain("cancelado");
  });

  it("la corrección queda en la bitácora, identificada como del Administrador", async () => {
    const { viajeId, segundaId } = await escenario("Completado");
    rolActual = "Administrador";
    await cambiarPlantaViajeAction(viajeId, segundaId);

    const reg = await prisma.bitacora_auditoria.findFirstOrThrow({
      where: { tabla_afectada: "viajes", registro_id: viajeId, campo_modificado: "planta_id" },
      orderBy: { id: "desc" },
    });
    expect(reg.valor_anterior).toBe("SM Planta P1");
    expect(reg.valor_nuevo).toBe("SM Planta P2");
    expect(reg.motivo).toContain("Administrador");
    expect(reg.motivo).toContain("ya salió");
  });

  it("un cambio normal (antes de arrancar) NO se marca como corrección del Admin", async () => {
    const { viajeId, segundaId } = await escenario(null);
    rolActual = "Administrador";
    await cambiarPlantaViajeAction(viajeId, segundaId);

    const reg = await prisma.bitacora_auditoria.findFirstOrThrow({
      where: { tabla_afectada: "viajes", registro_id: viajeId, campo_modificado: "planta_id" },
      orderBy: { id: "desc" },
    });
    expect(reg.motivo).not.toContain("Administrador");
    expect(reg.motivo).toContain("despacho");
  });
});
