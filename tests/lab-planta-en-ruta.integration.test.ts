// El LABORATORISTA DE PLANTA solo puede despachar el mixer que cargó en SU planta:
// marca "En ruta" y nada más. Se prueba en la server action, no en la pantalla:
// esconder botones no es una restricción.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";
import { avanzarEstadoViaje, programarPedido } from "@/lib/motor/asignacion";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

const LAB = "lab-planta-1";

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "lab-planta-1", name: "Lab Planta", email: "lp@test.com" } }),
}));
vi.mock("@/lib/auth/guard", () => ({
  alcanceActual: async () => calcularAlcance(["Laboratorista"], "Norte", null, null, []),
  requerirAcceso: async () => calcularAlcance(["Laboratorista"], "Norte", null, null, []),
  exigirAdmin: async () => ({ ok: true, userId: LAB }),
  exigirGestionFlota: async () => ({ ok: true, userId: LAB }),
  requerirPasswordAlDia: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { avanzarEstadoAction } = await import("@/app/actions");

/** El día que opera Despacho es HOY. */
function hoyALas(h: number): Date {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d;
}

async function escenario() {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "Santa Marta",
    zona: "Norte",
    esHub: true,
    capacidadPlantaM3h: 45,
  });
  const otraPlanta = await prisma.plantas.create({
    data: { plantel_id: plantelId, nombre: "SANY", capacidad_m3h: 28, tiempo_alistamiento_min: 5 },
  });
  await crearMixers(plantelId, [[11, 4]]);
  const dia = hoyALas(8);
  const r = await programarPedido({
    cliente_id: await crearCliente(true, 30, 30),
    diseno_id: await crearDiseno(),
    plantel_id: plantelId,
    planta_id: plantaId,
    volumen_total_m3: 22,
    hora_solicitada: dia,
    tipo_descarga: "Canal directo",
    creado_por: "test",
  });
  // Es el laboratorista de báscula de la planta principal ese día.
  const soloDia = new Date(dia);
  soloDia.setHours(0, 0, 0, 0);
  await prisma.asignaciones_laboratorista_planta.create({
    data: { laboratorista_id: LAB, planta_id: plantaId, fecha: soloDia, creado_por: "jefe" },
  });
  return { plantelId, plantaId, otraPlanta, r, dia };
}

beforeEach(async () => {
  await limpiarBD();
  await prisma.asignaciones_laboratorista_planta.deleteMany();
  await prisma.user.upsert({
    where: { id: LAB },
    update: {},
    create: { id: LAB, email: "lp@test.com", name: "Lab Planta", activo: true },
  });
});

describe("laboratorista de planta en Despacho", () => {
  it("puede marcar En ruta de un viaje de SU planta", async () => {
    const e = await escenario();
    const viaje = e.r.viajes.find((v) => v.mixerId != null)!;
    await avanzarEstadoViaje(viaje.id, "En carga"); // lo carga el dosificador

    const res = await avanzarEstadoAction(viaje.id, "En ruta");
    expect(res.ok).toBe(true);
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: viaje.id } });
    expect(v.estado).toBe("En ruta");
    expect(v.ts_salida_real).not.toBeNull();
  });

  it("NO puede marcar ningún otro estado", async () => {
    const e = await escenario();
    const viaje = e.r.viajes.find((v) => v.mixerId != null)!;

    // "En carga" es del dosificador/despachador.
    const carga = await avanzarEstadoAction(viaje.id, "En carga");
    expect(carga.ok).toBe(false);
    expect(carga.mensaje).toContain("En ruta");

    // Y tampoco los de obra (ese programa no le fue asignado como proyecto).
    await avanzarEstadoViaje(viaje.id, "En carga");
    await avanzarEstadoViaje(viaje.id, "En ruta");
    const llegada = await avanzarEstadoAction(viaje.id, "Llegada");
    expect(llegada.ok).toBe(false);
  });

  it("NO puede tocar un viaje que carga en OTRA planta", async () => {
    const e = await escenario();
    const viaje = e.r.viajes.find((v) => v.mixerId != null)!;
    await prisma.viajes.update({ where: { id: viaje.id }, data: { planta_id: e.otraPlanta.id } });
    await avanzarEstadoViaje(viaje.id, "En carga");

    const res = await avanzarEstadoAction(viaje.id, "En ruta");
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain("no es de un proyecto asignado a ti ni carga en tu planta");
  });

  it("sin asignación de planta ese día no puede despachar nada", async () => {
    const e = await escenario();
    await prisma.asignaciones_laboratorista_planta.deleteMany();
    const viaje = e.r.viajes.find((v) => v.mixerId != null)!;
    await avanzarEstadoViaje(viaje.id, "En carga");

    const res = await avanzarEstadoAction(viaje.id, "En ruta");
    expect(res.ok).toBe(false);
  });
});
