// LATIDO de las pantallas en vivo (Postgres).
//
// La promesa que hay que sostener es exactamente una: **si la firma no cambió, no hay
// nada nuevo que mostrar**. Si se le escapara un cambio, la pantalla dejaría de
// refrescarse y el despachador vería datos viejos sin saberlo — peor que gastar
// transferencia. Por eso aquí se prueba un cambio de cada tipo.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { crearCliente, crearDiseno, crearPlantel, limpiarBD } from "./helpers";
import { diaDesdeISO, firmaLatido } from "@/lib/latido";

let haySesion = true;

vi.mock("@/auth", () => ({
  auth: async () =>
    haySesion ? { user: { id: "u1", name: "Prueba", email: "p@test.com" } } : null,
}));

const { GET } = await import("@/app/api/latido/route");

const DIA = new Date(2026, 7, 19);
const MANANA = new Date(2026, 7, 20);
const en = (h: number, m = 0) => new Date(2026, 7, 19, h, m, 0, 0);
const rango = { desde: DIA, hasta: MANANA };

async function escenario() {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "SM Latido",
    zona: "Norte",
    esHub: true,
  });
  const mixer = await prisma.mixers.create({
    data: { marca: "T", capacidad_m3: 12, plantel_base_id: plantelId, identificador: "M-01" },
  });
  const clienteId = await crearCliente(true);
  const disenoId = await crearDiseno();
  return { plantelId, plantaId, clienteId, disenoId, mixerId: mixer.id };
}

async function crearPedidoConViaje(e: Awaited<ReturnType<typeof escenario>>, hora = en(8)) {
  const pedido = await prisma.pedidos.create({
    data: {
      cliente_id: e.clienteId,
      diseno_id: e.disenoId,
      volumen_total_m3: 9,
      hora_solicitada: hora,
      plantel_id: e.plantelId,
      planta_id: e.plantaId,
      tipo_descarga: "Canal directo",
      creado_por: "prueba",
    },
  });
  const viaje = await prisma.viajes.create({
    data: {
      pedido_id: pedido.id,
      planta_id: e.plantaId,
      mixer_id: e.mixerId,
      capacidad_asignada_m3: 11,
      volumen_asignado_m3: 9,
      hora_solicitada: hora,
      hora_inicio_carga: hora,
      estado: "Programado",
    },
  });
  return { pedidoId: pedido.id, viajeId: viaje.id };
}

beforeEach(async () => {
  await limpiarBD();
  haySesion = true;
});

describe("la firma solo cambia cuando hay algo nuevo", () => {
  it("dos lecturas seguidas sin cambios dan la MISMA firma", async () => {
    const e = await escenario();
    await crearPedidoConViaje(e);
    const a = await firmaLatido(rango);
    const b = await firmaLatido(rango);
    expect(b).toBe(a);
  });

  it("un pedido nuevo cambia la firma", async () => {
    const e = await escenario();
    const antes = await firmaLatido(rango);
    await crearPedidoConViaje(e);
    expect(await firmaLatido(rango)).not.toBe(antes);
  });

  it("avanzar el estado de un viaje cambia la firma", async () => {
    const e = await escenario();
    const { viajeId } = await crearPedidoConViaje(e);
    const antes = await firmaLatido(rango);
    await prisma.viajes.update({ where: { id: viajeId }, data: { estado: "En carga" } });
    expect(await firmaLatido(rango)).not.toBe(antes);
  });

  it("editar el volumen o el mixer de un viaje cambia la firma", async () => {
    const e = await escenario();
    const { viajeId } = await crearPedidoConViaje(e);
    let antes = await firmaLatido(rango);
    await prisma.viajes.update({ where: { id: viajeId }, data: { volumen_real_m3: 7 } });
    const medio = await firmaLatido(rango);
    expect(medio).not.toBe(antes);

    antes = medio;
    await prisma.viajes.update({ where: { id: viajeId }, data: { mixer_id: null } });
    expect(await firmaLatido(rango)).not.toBe(antes);
  });

  it("la confirmación del asesor cambia la firma (es el caso que originó el refresco)", async () => {
    const e = await escenario();
    const { viajeId } = await crearPedidoConViaje(e);
    const antes = await firmaLatido(rango);
    await prisma.viajes.update({
      where: { id: viajeId },
      data: { estado_confirmacion: "Confirmado", fecha_hora_confirmacion: new Date() },
    });
    expect(await firmaLatido(rango)).not.toBe(antes);
  });

  it("cancelar un viaje cambia la firma", async () => {
    const e = await escenario();
    const { viajeId } = await crearPedidoConViaje(e);
    const antes = await firmaLatido(rango);
    await prisma.viajes.update({ where: { id: viajeId }, data: { estado: "Cancelado" } });
    expect(await firmaLatido(rango)).not.toBe(antes);
  });

  it("borrar un viaje cambia la firma (el conteo baja)", async () => {
    const e = await escenario();
    const { viajeId } = await crearPedidoConViaje(e);
    const antes = await firmaLatido(rango);
    await prisma.viajes.delete({ where: { id: viajeId } });
    expect(await firmaLatido(rango)).not.toBe(antes);
  });

  it("editar el pedido (observaciones, hora, volumen) cambia la firma", async () => {
    const e = await escenario();
    const { pedidoId } = await crearPedidoConViaje(e);
    const antes = await firmaLatido(rango);
    await prisma.pedidos.update({
      where: { id: pedidoId },
      data: { observaciones: "Enviar el vibrador" },
    });
    expect(await firmaLatido(rango)).not.toBe(antes);
  });

  it("la observación del plantel del día cambia la firma", async () => {
    const e = await escenario();
    await crearPedidoConViaje(e);
    const antes = await firmaLatido(rango);
    await prisma.observaciones_plantel.create({
      data: {
        plantel_id: e.plantelId,
        fecha: DIA,
        texto: "Enviar 5 mixer a Choloma",
        creado_por: "prueba",
      },
    });
    expect(await firmaLatido(rango)).not.toBe(antes);
  });

  it("una captura de calidad del viaje cambia la firma", async () => {
    const e = await escenario();
    const { viajeId } = await crearPedidoConViaje(e);
    const antes = await firmaLatido(rango);
    await prisma.control_calidad_viaje.create({
      data: { viaje_id: viajeId, revenimiento_obra: 5.75 },
    });
    expect(await firmaLatido(rango)).not.toBe(antes);
  });

  it("asignar un laboratorista al programa cambia la firma", async () => {
    const e = await escenario();
    const { pedidoId } = await crearPedidoConViaje(e);
    const usuario = await prisma.user.create({ data: { name: "Lab", email: "lab@latido.test" } });
    const antes = await firmaLatido(rango);
    await prisma.asignaciones_laboratorista.create({
      data: { pedido_id: pedidoId, laboratorista_id: usuario.id, creado_por: "prueba" },
    });
    expect(await firmaLatido(rango)).not.toBe(antes);
  });
});

describe("la firma está acotada al rango", () => {
  it("un cambio en OTRO día no mueve la firma del día que se está viendo", async () => {
    const e = await escenario();
    await crearPedidoConViaje(e, en(8));
    const antes = await firmaLatido(rango);

    // Pedido de mañana: la pantalla de hoy no lo muestra, así que no debe refrescarse.
    await crearPedidoConViaje(e, new Date(2026, 7, 20, 8, 0));
    expect(await firmaLatido(rango)).toBe(antes);

    // Y la firma de mañana sí cambió.
    const manana = { desde: MANANA, hasta: new Date(2026, 7, 21) };
    expect(await firmaLatido(manana)).not.toBe(antes);
  });

  it("un rango de varios días (Confirmaciones) ve los cambios de todos ellos", async () => {
    const e = await escenario();
    const dosDias = { desde: DIA, hasta: new Date(2026, 7, 21) };
    const antes = await firmaLatido(dosDias);
    await crearPedidoConViaje(e, new Date(2026, 7, 20, 8, 0));
    expect(await firmaLatido(dosDias)).not.toBe(antes);
  });
});

describe("el endpoint", () => {
  it("responde una firma corta y sin caché", async () => {
    const e = await escenario();
    await crearPedidoConViaje(e);
    const res = await GET(new Request("http://localhost/api/latido?desde=2026-08-19"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const cuerpo = await res.text();
    // El punto de todo esto: la respuesta pesa unos cientos de bytes, no decenas de KB.
    expect(cuerpo.length).toBeLessThan(300);
    expect(JSON.parse(cuerpo).v).toBe(await firmaLatido(rango));
  });

  it("sin sesión responde 401", async () => {
    haySesion = false;
    const res = await GET(new Request("http://localhost/api/latido?desde=2026-08-19"));
    expect(res.status).toBe(401);
  });

  it("sin fecha válida responde 400", async () => {
    const res = await GET(new Request("http://localhost/api/latido?desde=19-08-2026"));
    expect(res.status).toBe(400);
  });

  it("acepta un rango de varios días", async () => {
    const res = await GET(
      new Request("http://localhost/api/latido?desde=2026-08-19&hasta=2026-08-21"),
    );
    expect(res.status).toBe(200);
  });

  it("diaDesdeISO solo acepta YYYY-MM-DD", () => {
    expect(diaDesdeISO("2026-08-19")?.getDate()).toBe(19);
    expect(diaDesdeISO("2026-8-19")).toBeNull();
    expect(diaDesdeISO("")).toBeNull();
    expect(diaDesdeISO(null)).toBeNull();
  });
});
