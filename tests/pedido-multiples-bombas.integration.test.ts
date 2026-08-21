// Un pedido puede llevar VARIAS bombas: obras grandes con dos o más equipos de bombeo
// colocando a la vez. La fuente única del dato es `pedidos_bombas`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";
import { detectarAlertasMargen, modificarPedido, programarPedido } from "@/lib/motor/asignacion";
import { construirSnapshot, ymd } from "@/lib/programa/snapshot";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

// Para probar el camino REAL del formulario (que manda un `bomba_id` por selector).
vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "u1", name: "Admin Prueba", email: "a@test.com" } }),
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

const DIA = new Date(2026, 7, 26, 8, 0, 0, 0);

async function escenario() {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "Santa Marta",
    zona: "Norte",
    esHub: true,
    capacidadPlantaM3h: 45,
  });
  await crearMixers(plantelId, [[11, 4]]);
  const b1 = await prisma.bombas.create({
    data: { identificador: "45BC-06", estado: "Disponible", plantel_base_id: plantelId },
  });
  const b2 = await prisma.bombas.create({
    data: { identificador: "45BC-04", estado: "Disponible", plantel_base_id: plantelId },
  });
  const b3 = await prisma.bombas.create({
    data: { identificador: "32BC-01", estado: "Disponible", plantel_base_id: plantelId },
  });
  const clienteId = await crearCliente(true, 30, 30);
  const disenoId = await crearDiseno();
  return { plantelId, plantaId, clienteId, disenoId, b1, b2, b3 };
}

const base = (e: Awaited<ReturnType<typeof escenario>>, bombas_ids?: number[]) => ({
  cliente_id: e.clienteId,
  diseno_id: e.disenoId,
  plantel_id: e.plantelId,
  planta_id: e.plantaId,
  volumen_total_m3: 33,
  hora_solicitada: DIA,
  tipo_descarga: "Bomba estacionaria",
  creado_por: "test",
  ...(bombas_ids ? { bombas_ids } : {}),
});

const bombasDe = async (pedidoId: number) =>
  (
    await prisma.pedidos_bombas.findMany({
      where: { pedido_id: pedidoId },
      include: { bomba: { select: { identificador: true } } },
      orderBy: { id: "asc" },
    })
  ).map((x) => x.bomba.identificador);

beforeEach(async () => {
  await limpiarBD();
  await prisma.pedidos_bombas.deleteMany();
  await prisma.bombas.deleteMany();
});

describe("varias bombas por pedido", () => {
  it("guarda las DOS bombas elegidas", async () => {
    const e = await escenario();
    const r = await programarPedido(base(e, [e.b1.id, e.b2.id]));
    expect(await bombasDe(r.pedidoId)).toEqual(["45BC-06", "45BC-04"]);
  });

  it("acepta tres o más", async () => {
    const e = await escenario();
    const r = await programarPedido(base(e, [e.b1.id, e.b2.id, e.b3.id]));
    expect(await bombasDe(r.pedidoId)).toHaveLength(3);
  });

  it("ignora repetidas (el mismo id dos veces no duplica la fila)", async () => {
    const e = await escenario();
    const r = await programarPedido(base(e, [e.b1.id, e.b1.id, e.b2.id]));
    expect(await bombasDe(r.pedidoId)).toEqual(["45BC-06", "45BC-04"]);
  });

  it("sin elegir ninguna, el motor auto-asigna UNA por hub", async () => {
    const e = await escenario();
    const r = await programarPedido(base(e));
    expect(await bombasDe(r.pedidoId)).toHaveLength(1);
  });

  it("canal directo no lleva bomba", async () => {
    const e = await escenario();
    const r = await programarPedido({ ...base(e), tipo_descarga: "Canal directo" });
    expect(await bombasDe(r.pedidoId)).toEqual([]);
  });

  it("al editar el pedido, la lista se REEMPLAZA (no se acumula)", async () => {
    const e = await escenario();
    const r = await programarPedido(base(e, [e.b1.id, e.b2.id]));
    await modificarPedido(r.pedidoId, base(e, [e.b3.id]));
    expect(await bombasDe(r.pedidoId)).toEqual(["32BC-01"]);
  });

  it("el DPCR-08 imprime un chip por bomba, cada uno con su color", async () => {
    const e = await escenario();
    await programarPedido(base(e, [e.b1.id, e.b2.id]));
    const snap = await construirSnapshot({ fecha: ymd(DIA), zona: "Norte" });
    const p = snap.planteles.flatMap((pl) => pl.pedidos)[0];
    expect(p.bombas.map((b) => b.codigo)).toEqual(["45BC-06", "45BC-04"]);
    // Colores distintos entre bombas (la leyenda del día las diferencia).
    expect(new Set(p.bombas.map((b) => b.color)).size).toBe(2);
    expect(snap.bombas.map((b) => b.codigo).sort()).toEqual(["45BC-04", "45BC-06"]);
  });

  it("por el FORMULARIO: dos selectores de bomba llegan como dos bombas", async () => {
    const e = await escenario();
    const fd = new FormData();
    fd.set("cliente_id", String(e.clienteId));
    fd.set("diseno_id", String(e.disenoId));
    fd.set("plantel_id", String(e.plantelId));
    fd.set("planta_id", String(e.plantaId));
    fd.set("volumen_total_m3", "33");
    fd.set("hora_solicitada", "2026-08-26T08:00");
    fd.set("tipo_descarga", "Bomba estacionaria");
    // Así lo manda el form: un `bomba_id` por cada selector.
    fd.append("bomba_id", String(e.b1.id));
    fd.append("bomba_id", String(e.b2.id));

    const res = await crearPedidoAction({ ok: false }, fd);
    expect(res.ok).toBe(true);
    const pedido = await prisma.pedidos.findFirstOrThrow({ orderBy: { id: "desc" } });
    expect(await bombasDe(pedido.id)).toEqual(["45BC-06", "45BC-04"]);
  });

  it("rechaza si UNA de las bombas elegidas está en mantenimiento", async () => {
    const e = await escenario();
    await prisma.disponibilidad_flota.create({
      data: {
        unidad_tipo: "Bomba",
        unidad_id: e.b2.id,
        fecha_inicio: new Date(2026, 7, 25),
        fecha_fin: new Date(2026, 7, 27),
        tipo_evento: "Mantenimiento_Programado",
        estado: "Programado",
        creado_por: "test",
      },
    });
    const fd = new FormData();
    fd.set("cliente_id", String(e.clienteId));
    fd.set("diseno_id", String(e.disenoId));
    fd.set("plantel_id", String(e.plantelId));
    fd.set("planta_id", String(e.plantaId));
    fd.set("volumen_total_m3", "11");
    fd.set("hora_solicitada", "2026-08-26T08:00");
    fd.set("tipo_descarga", "Bomba estacionaria");
    fd.append("bomba_id", String(e.b1.id)); // libre
    fd.append("bomba_id", String(e.b2.id)); // en mantenimiento

    const res = await crearPedidoAction({ ok: false }, fd);
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain("45BC-04");
    expect(res.mensaje).toContain("mantenimiento");
  });

  it("las alertas de traslape miran TODAS las bombas del pedido", async () => {
    const e = await escenario();
    // Dos pedidos a la misma hora compartiendo la bomba b2: la ocupación de b2 se
    // detecta aunque en cada pedido venga acompañada de otra bomba.
    await programarPedido(base(e, [e.b1.id, e.b2.id]));
    await programarPedido(base(e, [e.b2.id, e.b3.id]));
    const alertas = await detectarAlertasMargen(DIA);
    expect(alertas.some((a) => a.tipoUnidad === "bomba" && a.unidadId === e.b2.id)).toBe(true);
  });
});
