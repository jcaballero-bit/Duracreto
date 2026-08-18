// Observaciones (pedido y plantel) en el LÍMITE REAL de la server action.
//
// Son texto libre que escriben el Programador, el Jefe de Planta y el Administrador,
// y que después ven todos en Despacho en vivo y en el Programa DPCR-08. Aquí se
// comprueba lo que no se puede garantizar desde la interfaz: que un rol sin permiso
// de escritura es rechazado aunque invoque la acción directamente, que guardar vacío
// BORRA la nota (no deja una fila vacía) y que el snapshot del DPCR-08 las arrastra.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";
import { programarPedido } from "@/lib/motor/asignacion";
import { construirSnapshot, ymd } from "@/lib/programa/snapshot";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

let rolActual: "Administrador" | "Programador" | "JefePlanta" | "Asesor" = "Programador";
let plantelesJefe: number[] = [];

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

const { guardarObservacionPlantelAction } = await import("@/app/actions");

/** Día de trabajo: hoy a las 8:00 (el Programador puede operar hoy en adelante). */
function hoyALas(h: number): Date {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d;
}

async function escenario() {
  const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Obs", zona: "Norte", esHub: true });
  await crearMixers(plantelId, [[11, 2]]);
  const clienteId = await crearCliente(true, 30, 30);
  const disenoId = await crearDiseno();
  plantelesJefe = [plantelId];
  return { plantelId, plantaId, clienteId, disenoId };
}

beforeEach(async () => {
  await limpiarBD();
  rolActual = "Programador";
  plantelesJefe = [];
});

describe("Observaciones del plantel", () => {
  it("el Programador la guarda, la reemplaza y la borra al dejarla vacía", async () => {
    const { plantelId } = await escenario();
    const dia = hoyALas(8);
    const fechaISO = ymd(dia);

    const alta = await guardarObservacionPlantelAction(plantelId, fechaISO, "Enviar 5 mixer a Choloma");
    expect(alta.ok).toBe(true);
    const guardada = await prisma.observaciones_plantel.findFirst({ where: { plantel_id: plantelId } });
    expect(guardada?.texto).toBe("Enviar 5 mixer a Choloma");

    // Una segunda nota del mismo día REEMPLAZA (no acumula filas).
    await guardarObservacionPlantelAction(plantelId, fechaISO, "Enviar 3 mixer a Villanueva");
    const filas = await prisma.observaciones_plantel.findMany({ where: { plantel_id: plantelId } });
    expect(filas).toHaveLength(1);
    expect(filas[0].texto).toBe("Enviar 3 mixer a Villanueva");

    // Vacío = borrar (no dejar una nota en blanco colgada).
    await guardarObservacionPlantelAction(plantelId, fechaISO, "   ");
    expect(await prisma.observaciones_plantel.count({ where: { plantel_id: plantelId } })).toBe(0);
  });

  it("un rol sin permiso de escritura es rechazado aunque invoque la acción directamente", async () => {
    const { plantelId } = await escenario();
    rolActual = "Asesor"; // no opera pedidos: `puedeOperarEnFecha` es false
    const res = await guardarObservacionPlantelAction(plantelId, ymd(hoyALas(8)), "No debería guardarse");
    expect(res.ok).toBe(false);
    expect(await prisma.observaciones_plantel.count({ where: { plantel_id: plantelId } })).toBe(0);
  });

  it("el Jefe de Planta solo puede escribir en SUS planteles", async () => {
    const { plantelId } = await escenario();
    const otro = await crearPlantel({ nombre: "Otro Plantel", zona: "Norte" });
    rolActual = "JefePlanta";
    plantelesJefe = [plantelId]; // el otro plantel no es suyo

    expect((await guardarObservacionPlantelAction(plantelId, ymd(hoyALas(8)), "Ok")).ok).toBe(true);
    const ajeno = await guardarObservacionPlantelAction(otro.plantelId, ymd(hoyALas(8)), "Ajeno");
    expect(ajeno.ok).toBe(false);
    expect(await prisma.observaciones_plantel.count({ where: { plantel_id: otro.plantelId } })).toBe(0);
  });
});

describe("Observaciones en el Programa DPCR-08", () => {
  it("el snapshot arrastra la nota del plantel y la del cliente; vacías quedan en blanco", async () => {
    const { plantelId, plantaId, clienteId, disenoId } = await escenario();
    const dia = hoyALas(8);

    await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      plantel_id: plantelId,
      planta_id: plantaId,
      volumen_total_m3: 18,
      hora_solicitada: dia,
      tipo_descarga: "Canal directo",
      observaciones: "Entrar por el porton trasero",
      creado_por: "test",
    });
    await guardarObservacionPlantelAction(plantelId, ymd(dia), "Enviar 5 mixer a Choloma");

    const snap = await construirSnapshot({ fecha: ymd(dia), zona: "Norte" });
    const pl = snap.planteles.find((x) => x.id === plantelId);
    expect(pl?.observaciones).toBe("Enviar 5 mixer a Choloma");
    expect(pl?.pedidos[0].observaciones).toBe("Entrar por el porton trasero");

    // Un plantel sin nota no trae basura: cadena vacía (el documento no imprime nada).
    const otro = await crearPlantel({ nombre: "Sin Nota", zona: "Norte" });
    const snap2 = await construirSnapshot({ fecha: ymd(dia), zona: "Norte" });
    expect(snap2.planteles.find((x) => x.id === otro.plantelId)?.observaciones).toBe("");
  });
});
