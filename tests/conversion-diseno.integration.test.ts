// Al convertir una proyección del asesor, el DISEÑO DE MEZCLA no se auto-selecciona:
// lo elige el Programador / Jefe de Planta mirando lo que pidió el asesor.
//
// El asesor describe el concreto con sus palabras ("4500 3/4") y adivinar el diseño
// llevaba a despachar una resistencia equivocada — un error que se funde en la obra y
// no se puede deshacer. Aquí se blinda el lado del SERVIDOR: sin diseño no se crea el
// pedido, aunque se llame la acción directamente.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "u1", name: "Programador Prueba", email: "p@test.com" } }),
}));
vi.mock("@/lib/auth/guard", () => ({
  alcanceActual: async () => calcularAlcance(["Administrador"], null, null, null, []),
  requerirAcceso: async () => calcularAlcance(["Administrador"], null, null, null, []),
  exigirAdmin: async () => ({ ok: true, userId: "u1" }),
  exigirGestionFlota: async () => ({ ok: true, userId: "u1" }),
  requerirPasswordAlDia: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { crearPedidoAction } = await import("@/app/actions");

/** Formulario de conversión, con el diseño que se le pase (o sin diseño). */
function formulario(
  e: { clienteId: number; plantelId: number; plantaId: number },
  disenoId?: number | string,
) {
  const fd = new FormData();
  fd.set("cliente_id", String(e.clienteId));
  fd.set("plantel_id", String(e.plantelId));
  fd.set("planta_id", String(e.plantaId));
  fd.set("volumen_total_m3", "30");
  fd.set("hora_solicitada", "2026-08-30T08:00");
  fd.set("tipo_descarga", "Canal directo");
  if (disenoId !== undefined) fd.set("diseno_id", String(disenoId));
  return fd;
}

async function escenario() {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "Santa Marta",
    zona: "Norte",
    esHub: true,
    capacidadPlantaM3h: 45,
  });
  await crearMixers(plantelId, [[11, 3]]);
  const clienteId = await crearCliente(true, 30, 30);
  const disenoId = await crearDiseno();
  return { plantelId, plantaId, clienteId, disenoId };
}

beforeEach(async () => {
  await limpiarBD();
});

describe("el diseño de mezcla no admite valor por descarte", () => {
  it("sin diseño no se crea el pedido, y el mensaje dice qué hacer", async () => {
    const e = await escenario();
    const res = await crearPedidoAction({ ok: false }, formulario(e));
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain("Elige el diseño de mezcla");
    expect(await prisma.pedidos.count()).toBe(0);
  });

  it("un diseño vacío (el valor del selector sin elegir) tampoco pasa", async () => {
    const e = await escenario();
    for (const valor of ["", "0", "abc"]) {
      const res = await crearPedidoAction({ ok: false }, formulario(e, valor));
      expect(res.ok).toBe(false);
      expect(res.mensaje).toContain("Elige el diseño de mezcla");
    }
    expect(await prisma.pedidos.count()).toBe(0);
  });

  it("con el diseño elegido, la conversión se guarda normalmente", async () => {
    const e = await escenario();
    const res = await crearPedidoAction({ ok: false }, formulario(e, e.disenoId));
    expect(res.ok).toBe(true);
    const pedido = await prisma.pedidos.findFirstOrThrow();
    expect(pedido.diseno_id).toBe(e.disenoId);
  });

  it("al convertir, la proyección queda Programada y vinculada al pedido", async () => {
    const e = await escenario();
    const solicitud = await prisma.solicitudes_anticipadas.create({
      data: {
        cliente_id: e.clienteId,
        fecha_requerida: new Date(2026, 7, 30),
        volumen_estimado_m3: 30,
        tipo_concreto_estimado: "4500 3/4", // lo que escribió el asesor
        estado: "Pendiente",
        creado_por: "asesor",
      },
    });
    const fd = formulario(e, e.disenoId);
    fd.set("solicitud_id", String(solicitud.id));

    const res = await crearPedidoAction({ ok: false }, fd);
    expect(res.ok).toBe(true);
    const despues = await prisma.solicitudes_anticipadas.findUniqueOrThrow({
      where: { id: solicitud.id },
    });
    expect(despues.estado).toBe("Programado");
    expect(despues.pedido_id).not.toBeNull();
  });
});
