// Cancelar un viaje desde Despacho en vivo: qué pantallas lo conservan y cuál no.
//
// La regla tiene una asimetría deliberada y es justo donde estaba el defecto:
//   · Programación y Programa DPCR-08 → el viaje SE QUEDA (con su mixer, su volumen y
//     sus horas). Son el programa publicado y no se reescriben porque un viaje se caiga.
//   · Reporte de Control de Calidad → el viaje SALE. Ahí solo se documenta concreto
//     despachado de planta, y un viaje cancelado no se ensayó. Si el cliente canceló
//     TODO su suministro, no aparece ni en el reporte ni en el selector de clientes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { crearCliente, crearDiseno, crearPlantel, limpiarBD } from "./helpers";
import { calcularAlcance } from "@/lib/auth/acceso";
import { construirSnapshot, totalImpreso, ymd } from "@/lib/programa/snapshot";
import { ESTADOS_DESPACHADO, fueDespachado } from "@/lib/motor/config";
import {
  WHERE_PEDIDO_CON_DESPACHO,
  WHERE_VIAJE_DESPACHADO,
} from "@/lib/calidad/seleccion";

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "u1", name: "Despachador Prueba", email: "d@test.com" } }),
}));
vi.mock("@/lib/auth/guard", () => ({
  alcanceActual: async () => calcularAlcance(["Administrador"], null),
  requerirAcceso: async () => calcularAlcance(["Administrador"], null),
  exigirAdmin: async () => ({ ok: true, userId: "u1" }),
  requerirPasswordAlDia: async () => {},
}));
// La caché de catálogos es un paso directo en pruebas: cada consulta va a la base, así
// las aserciones ven el dato fresco (en producción `unstable_cache` la sirve de memoria).
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

const { cancelarViajeAction } = await import("@/app/actions");

/** Día de trabajo: hoy (el Admin puede operar cualquier fecha). */
function hoyALas(h: number, m = 0): Date {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}
const HOY = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
})();

interface OpcionesViaje {
  plantelId: number;
  plantaId: number;
  clienteId: number;
  disenoId: number;
  mixerId: number;
  hora: Date;
  volumen?: number;
  /** Estado del viaje (por defecto ya despachado). */
  estado?: string;
}

async function crearPedidoConViajes(
  base: Omit<OpcionesViaje, "hora" | "mixerId" | "estado">,
  viajes: { hora: Date; mixerId: number; estado?: string; volumen?: number }[],
) {
  const volumenTotal = viajes.reduce((s, v) => s + (v.volumen ?? 9), 0);
  const pedido = await prisma.pedidos.create({
    data: {
      cliente_id: base.clienteId,
      diseno_id: base.disenoId,
      volumen_total_m3: volumenTotal,
      volumen_programado: volumenTotal,
      hora_solicitada: viajes[0].hora,
      plantel_id: base.plantelId,
      planta_id: base.plantaId,
      tipo_descarga: "Canal directo",
      creado_por: "prueba",
    },
  });
  const creados = [];
  for (const v of viajes) {
    creados.push(
      await prisma.viajes.create({
        data: {
          pedido_id: pedido.id,
          planta_id: base.plantaId,
          mixer_id: v.mixerId,
          capacidad_asignada_m3: 11,
          volumen_asignado_m3: v.volumen ?? 9,
          hora_solicitada: v.hora,
          hora_inicio_carga: v.hora,
          hora_fin_carga: new Date(v.hora.getTime() + 20 * 60_000),
          hora_salida_planta: new Date(v.hora.getTime() + 25 * 60_000),
          hora_llegada_proyecto: new Date(v.hora.getTime() + 45 * 60_000),
          hora_regreso_planta: new Date(v.hora.getTime() + 90 * 60_000),
          ts_inicio_carga_real: v.hora,
          ts_salida_real: new Date(v.hora.getTime() + 25 * 60_000),
          estado: v.estado ?? "Completado",
        },
      }),
    );
  }
  return { pedidoId: pedido.id, viajes: creados };
}

async function escenario() {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "SM Cancel",
    zona: "Norte",
    esHub: true,
  });
  const mixers = await Promise.all(
    ["M-01", "M-02", "M-03"].map((identificador) =>
      prisma.mixers.create({
        data: { marca: "T", capacidad_m3: 12, plantel_base_id: plantelId, identificador },
      }),
    ),
  );
  const clienteId = await crearCliente(true);
  const disenoId = await crearDiseno();
  return { plantelId, plantaId, clienteId, disenoId, mixers: mixers.map((m) => m.id) };
}

/** Viajes que el Reporte de Calidad mostraría para ese cliente y día. */
async function viajesDelReporte(clienteId: number) {
  const pedidos = await prisma.pedidos.findMany({
    where: {
      cliente_id: clienteId,
      estado_pedido: "Activo",
      hora_solicitada: { gte: HOY, lt: new Date(HOY.getTime() + 86_400_000) },
    },
    include: { viajes: { where: WHERE_VIAJE_DESPACHADO, orderBy: { id: "asc" } } },
  });
  return pedidos.filter((p) => p.viajes.length > 0).flatMap((p) => p.viajes.map((v) => v.id));
}

/** Clientes que ofrecería el selector del Reporte de Calidad. */
async function clientesDelReporte() {
  const pedidos = await prisma.pedidos.findMany({
    where: {
      estado_pedido: "Activo",
      hora_solicitada: { gte: HOY, lt: new Date(HOY.getTime() + 86_400_000) },
      ...WHERE_PEDIDO_CON_DESPACHO,
    },
    select: { cliente_id: true },
  });
  return [...new Set(pedidos.map((p) => p.cliente_id))];
}

beforeEach(async () => {
  await limpiarBD();
  await prisma.bitacora_auditoria.deleteMany();
});

describe("qué significa despachado de planta", () => {
  it("un viaje cancelado NO cuenta como despachado, aunque hubiera salido", () => {
    expect(fueDespachado("En ruta")).toBe(true);
    expect(fueDespachado("Completado")).toBe(true);
    expect(fueDespachado("Programado")).toBe(false);
    expect(fueDespachado("En carga")).toBe(false);
    expect(fueDespachado("Cancelado")).toBe(false);
    expect(ESTADOS_DESPACHADO).not.toContain("Cancelado");
  });
});

describe("Programación y DPCR-08 conservan el viaje cancelado", () => {
  it("el viaje sigue en la base con su mixer, volumen y horas intactos", async () => {
    const e = await escenario();
    const { viajes } = await crearPedidoConViajes(e, [
      { hora: hoyALas(7), mixerId: e.mixers[0], estado: "Programado" },
      { hora: hoyALas(9), mixerId: e.mixers[1], estado: "Programado" },
    ]);

    const antes = await prisma.viajes.findUnique({ where: { id: viajes[1].id } });
    const r = await cancelarViajeAction(viajes[1].id, "El cliente detuvo la fundición");
    expect(r.ok).toBe(true);

    const despues = await prisma.viajes.findUnique({ where: { id: viajes[1].id } });
    expect(despues).not.toBeNull();
    expect(despues!.estado).toBe("Cancelado");
    // Nada del programa se reescribió.
    expect(despues!.mixer_id).toBe(antes!.mixer_id);
    expect(despues!.volumen_asignado_m3).toBe(antes!.volumen_asignado_m3);
    expect(despues!.hora_inicio_carga?.getTime()).toBe(antes!.hora_inicio_carga?.getTime());
    expect(despues!.hora_llegada_proyecto?.getTime()).toBe(antes!.hora_llegada_proyecto?.getTime());
  });

  it("el DPCR-08 sigue imprimiendo el viaje y su total no cambia", async () => {
    const e = await escenario();
    const { viajes } = await crearPedidoConViajes(e, [
      { hora: hoyALas(7), mixerId: e.mixers[0], estado: "Programado", volumen: 9 },
      { hora: hoyALas(9), mixerId: e.mixers[1], estado: "Programado", volumen: 9 },
      { hora: hoyALas(11), mixerId: e.mixers[2], estado: "Programado", volumen: 7 },
    ]);

    const filasViaje = (snap: Awaited<ReturnType<typeof construirSnapshot>>) => {
      const pedido = snap.planteles.flatMap((p) => p.pedidos)[0];
      return {
        pedido,
        viajes: pedido.filas.filter((f): f is Extract<typeof f, { tipo: "viaje" }> => f.tipo === "viaje"),
      };
    };

    const antes = filasViaje(await construirSnapshot({ fecha: ymd(HOY), zona: "Norte" }));
    expect(antes.viajes).toHaveLength(3);

    await cancelarViajeAction(viajes[1].id, "Lluvia");

    const despues = filasViaje(await construirSnapshot({ fecha: ymd(HOY), zona: "Norte" }));
    // Las tres filas siguen impresas, con su numeración y su volumen.
    expect(despues.viajes).toHaveLength(3);
    expect(despues.viajes.map((v) => [v.num, v.volumen, v.mixer])).toEqual(
      antes.viajes.map((v) => [v.num, v.volumen, v.mixer]),
    );
    expect(despues.pedido.totalM3).toBe(antes.pedido.totalM3);
  });

  it("el total impreso incluye el viaje cancelado (el documento ya se publicó así)", async () => {
    const e = await escenario();
    const { pedidoId, viajes } = await crearPedidoConViajes(e, [
      { hora: hoyALas(7), mixerId: e.mixers[0], estado: "Programado", volumen: 9 },
      { hora: hoyALas(9), mixerId: e.mixers[1], estado: "Programado", volumen: 9 },
    ]);
    await cancelarViajeAction(viajes[0].id, "Cliente no estaba listo");

    const pedido = await prisma.pedidos.findUnique({
      where: { id: pedidoId },
      include: { viajes: true },
    });
    expect(totalImpreso(pedido!)).toBe(18);
  });

  it("la consulta de Programación NO filtra los viajes cancelados", async () => {
    // Guarda contra la regresión exacta que tenía el defecto: la pantalla excluía los
    // viajes cancelados y el Programador los veía desaparecer de su programa.
    const { readFileSync } = await import("node:fs");
    const fuente = readFileSync("app/programacion/page.tsx", "utf8");
    // Se busca el filtro que había: `where: { estado: { not: "Cancelado" } }` dentro de
    // la relación `viajes` del pedido.
    const bloque = fuente.slice(fuente.indexOf("        viajes: {"), fuente.indexOf("      orderBy: [{ orden_dia"));
    expect(bloque).not.toContain('estado: { not: "Cancelado" }');
    // Y la vista del viaje lleva la marca para poder mostrarlo como cancelado.
    expect(fuente).toContain('cancelado: v.estado === "Cancelado"');
  });
});

describe("el Reporte de Calidad solo muestra viajes despachados de planta", () => {
  it("el viaje cancelado sale del reporte, los despachados se quedan", async () => {
    const e = await escenario();
    const { viajes } = await crearPedidoConViajes(e, [
      { hora: hoyALas(7), mixerId: e.mixers[0], estado: "Completado" },
      // Ya salió de planta pero todavía no se entregó: es el caso real del usuario, y
      // es el único cancelable (un Completado ya no se puede cancelar).
      { hora: hoyALas(9), mixerId: e.mixers[1], estado: "En ruta" },
    ]);

    expect(await viajesDelReporte(e.clienteId)).toEqual([viajes[0].id, viajes[1].id]);

    await cancelarViajeAction(viajes[1].id, "Se devolvió el concreto");
    expect(await viajesDelReporte(e.clienteId)).toEqual([viajes[0].id]);
  });

  it("un viaje que todavía no salió de planta tampoco aparece", async () => {
    const e = await escenario();
    const { viajes } = await crearPedidoConViajes(e, [
      { hora: hoyALas(7), mixerId: e.mixers[0], estado: "Completado" },
      { hora: hoyALas(9), mixerId: e.mixers[1], estado: "Programado" },
      { hora: hoyALas(11), mixerId: e.mixers[2], estado: "En carga" },
    ]);
    // Solo el que ya salió: el Programado y el que está cargando no se ensayaron.
    expect(await viajesDelReporte(e.clienteId)).toEqual([viajes[0].id]);
  });

  it("si el cliente cancela TODO el suministro, no aparece en el reporte", async () => {
    const e = await escenario();
    const { viajes } = await crearPedidoConViajes(e, [
      { hora: hoyALas(7), mixerId: e.mixers[0], estado: "En ruta" },
      { hora: hoyALas(9), mixerId: e.mixers[1], estado: "Descargando" },
    ]);
    expect(await clientesDelReporte()).toContain(e.clienteId);

    for (const v of viajes) await cancelarViajeAction(v.id, "Cliente canceló todo");

    // Ni viajes ni cliente en el selector.
    expect(await viajesDelReporte(e.clienteId)).toEqual([]);
    expect(await clientesDelReporte()).not.toContain(e.clienteId);
    // Pero el programa publicado no perdió nada.
    const snap = await construirSnapshot({ fecha: ymd(HOY), zona: "Norte" });
    const pedidoSnap = snap.planteles.flatMap((p) => p.pedidos)[0];
    expect(pedidoSnap.filas.filter((f) => f.tipo === "viaje")).toHaveLength(2);
  });

  it("cancelar el PEDIDO completo también lo saca del reporte", async () => {
    const e = await escenario();
    await crearPedidoConViajes(e, [{ hora: hoyALas(7), mixerId: e.mixers[0], estado: "Completado" }]);
    expect(await clientesDelReporte()).toContain(e.clienteId);

    // Un pedido con estado_pedido = "Cancelado" ya no es programa activo.
    await prisma.pedidos.updateMany({
      where: { cliente_id: e.clienteId },
      data: { estado_pedido: "Cancelado" },
    });
    expect(await clientesDelReporte()).not.toContain(e.clienteId);
    expect(await viajesDelReporte(e.clienteId)).toEqual([]);
  });

  it("otro cliente del mismo día no se ve afectado", async () => {
    const e = await escenario();
    const otroCliente = await prisma.clientes.create({
      data: { empresa: "Otro cliente", ubicacion: "X", tiempo_viaje_referencia_min: 20, tiempo_regreso_referencia_min: 20 },
    });
    const mio = await crearPedidoConViajes(e, [
      { hora: hoyALas(7), mixerId: e.mixers[0], estado: "En ruta" },
    ]);
    await crearPedidoConViajes(
      { ...e, clienteId: otroCliente.id },
      [{ hora: hoyALas(13), mixerId: e.mixers[1], estado: "Completado" }],
    );

    await cancelarViajeAction(mio.viajes[0].id, "Cancelado");

    expect(await clientesDelReporte()).toEqual([otroCliente.id]);
  });
});

describe("auditoría", () => {
  it("la cancelación del viaje queda en la bitácora con su motivo", async () => {
    const e = await escenario();
    const { viajes } = await crearPedidoConViajes(e, [
      { hora: hoyALas(7), mixerId: e.mixers[0], estado: "Programado" },
    ]);
    await cancelarViajeAction(viajes[0].id, "Lluvia en el proyecto");

    const bit = await prisma.bitacora_auditoria.findFirst({
      where: { tabla_afectada: "viajes", registro_id: viajes[0].id },
      orderBy: { id: "desc" },
    });
    expect(bit!.valor_anterior).toBe("Programado");
    expect(bit!.valor_nuevo).toBe("Cancelado");
    expect(bit!.motivo).toContain("Lluvia en el proyecto");
  });

  it("un viaje ya completado no se puede cancelar", async () => {
    const e = await escenario();
    const { viajes } = await crearPedidoConViajes(e, [
      { hora: hoyALas(7), mixerId: e.mixers[0], estado: "Completado" },
    ]);
    const r = await cancelarViajeAction(viajes[0].id);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("ya completado");
    expect((await prisma.viajes.findUnique({ where: { id: viajes[0].id } }))!.estado).toBe(
      "Completado",
    );
  });
});
