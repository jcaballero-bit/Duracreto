// Integración del motor de 2 pasadas (organizarDia) contra la BD de prueba.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { organizarDia, programarPedido } from "@/lib/motor/asignacion";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

const DIA = new Date("2026-08-01T08:00:00");

beforeEach(async () => {
  await limpiarBD();
});

describe("organizarDia (2 pasadas: anclas primero, relleno después)", () => {
  it("pone el pedido multi-viaje (ancla) antes que el pedido de 1 viaje (corto)", async () => {
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "Hub Org",
      zona: "Norte",
      esHub: true,
    });
    await crearMixers(plantelId, [
      [9, 3],
      [7, 3],
    ]);
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const base = {
      cliente_id: clienteId,
      diseno_id: disenoId,
      hora_solicitada: DIA,
      plantel_id: plantelId,
      planta_id: plantaId,
      tipo_descarga: "Directo",
      creado_por: "test",
    };

    // Se crea PRIMERO el corto (1 viaje, 7 m³) → orden_dia inicial 1.
    const corto = await programarPedido({ ...base, volumen_total_m3: 7 });
    // Luego el ancla (multi-viaje, 18 m³ → 9+9) → orden_dia inicial 2.
    const ancla = await programarPedido({ ...base, volumen_total_m3: 18 });

    const antes = await prisma.pedidos.findMany({
      where: { plantel_id: plantelId },
      select: { id: true, orden_dia: true },
      orderBy: { orden_dia: "asc" },
    });
    expect(antes.map((p) => p.id)).toEqual([corto.pedidoId, ancla.pedidoId]); // corto=1, ancla=2

    // Organizar el día: el ancla debe pasar ANTES que el corto.
    const res = await organizarDia(plantelId, DIA, "test");
    expect(res.ok).toBe(true);

    const ordenCorto = (await prisma.pedidos.findUniqueOrThrow({
      where: { id: corto.pedidoId },
      select: { orden_dia: true },
    })).orden_dia;
    const ordenAncla = (await prisma.pedidos.findUniqueOrThrow({
      where: { id: ancla.pedidoId },
      select: { orden_dia: true },
    })).orden_dia;

    expect(ordenAncla).not.toBeNull();
    expect(ordenCorto).not.toBeNull();
    expect(ordenAncla!).toBeLessThan(ordenCorto!); // ancla primero (esqueleto del día)

    // La cascada quedó consistente: el ancla tiene 2 viajes con mixer, el corto 1.
    const viajesAncla = await prisma.viajes.count({
      where: { pedido_id: ancla.pedidoId, mixer_id: { not: null } },
    });
    expect(viajesAncla).toBe(2);
  });
});
