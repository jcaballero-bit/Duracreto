// El ADMINISTRADOR borra un viaje que se cargó POR ERROR en Despacho en vivo.
//
// Cancelar no sirve para ese caso: el viaje cancelado SIGUE apareciendo en el tablero
// (a propósito: el programa publicado no se reescribe porque un camión se caiga) y,
// al cerrar el pedido por debajo de su línea base, el dashboard comercial lo carga
// como CANCELACIÓN del asesor. Eliminar es para el viaje que no debió existir: se va
// y no deja rastro en ningún estadístico.
//
// Se prueba por las SERVER ACTIONS —el privilegio sale de la sesión, así que probar
// el motor directo no verificaría el permiso— y midiendo cada estadístico ANTES y
// DESPUÉS de borrar.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";
import { avanzarEstadoViaje, programarPedido } from "@/lib/motor/asignacion";
import { ESTADO_VIAJE_COMPLETADO, SECUENCIA_ESTADOS_VIAJE } from "@/lib/motor/config";
import { construirSnapshot, ymd, type FilaSnap, type ViajeSnap } from "@/lib/programa/snapshot";
import { produccionDelMes } from "@/lib/produccion/consulta";
import { calcularDesempeno } from "@/lib/comercial/metricas";
import { calcularReportes } from "@/lib/reportes/metricas";
import { calcularExtraordinario } from "@/lib/extraordinario/metricas";
import { calcularDescargas } from "@/lib/reportes/descargas-datos";
import { UMBRALES_DESCARGA_DEFAULT } from "@/lib/reportes/descargas";
import { firmaLatido } from "@/lib/latido";
import { ventanaDePedido } from "@/lib/laboratorio/ventana";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

type Rol =
  | "Administrador"
  | "Despachador"
  | "JefePlanta"
  | "Programador"
  | "Dosificador"
  | "Asesor";

let rolActual: Rol = "Administrador";
let plantelesJefe: number[] = [];

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "u1", name: "Admin Prueba", email: "a@test.com" } }),
}));
vi.mock("@/lib/auth/guard", () => ({
  alcanceActual: async () => calcularAlcance([rolActual], "Norte", null, null, plantelesJefe),
  requerirAcceso: async () => calcularAlcance([rolActual], "Norte", null, null, plantelesJefe),
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

const { eliminarViajeDespachoAction, cancelarViajeAction, agregarViajePedidoAction } = await import(
  "@/app/actions"
);

/** HOY a la hora `h` — el día que opera Despacho en vivo. */
function hoyALas(h: number): Date {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d;
}
const inicioDeHoy = () => hoyALas(0);
const finDeHoy = () => {
  const d = inicioDeHoy();
  d.setDate(d.getDate() + 1);
  return d;
};

/** Lleva un viaje hasta Completado por la secuencia real de estados. */
async function completar(viajeId: number) {
  for (const estado of SECUENCIA_ESTADOS_VIAJE) {
    await avanzarEstadoViaje(viajeId, estado);
    if (estado === ESTADO_VIAJE_COMPLETADO) break;
  }
}

/** Un pedido de programa con su asesor, para poder medir el dashboard comercial. */
async function escenario(volumen = 33) {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "Santa Marta",
    zona: "Norte",
    esHub: true,
    capacidadPlantaM3h: 45,
  });
  await crearMixers(plantelId, [[11, 4]]);
  const asesorId = (
    await prisma.asesores.create({
      data: { nombre: "Asesora Prueba", correo: `a${Date.now()}@test.com` },
    })
  ).id;
  const clienteId = await crearCliente(true, 30, 30);
  await prisma.clientes.update({ where: { id: clienteId }, data: { asesor_id: asesorId } });
  const disenoId = await crearDiseno();
  const dia = hoyALas(8);
  const r = await programarPedido({
    cliente_id: clienteId,
    diseno_id: disenoId,
    asesor_id: asesorId,
    plantel_id: plantelId,
    planta_id: plantaId,
    volumen_total_m3: volumen,
    hora_solicitada: dia,
    tipo_descarga: "Canal directo",
    creado_por: "test",
  });
  const viajes = await prisma.viajes.findMany({
    where: { pedido_id: r.pedidoId, mixer_id: { not: null } },
    orderBy: { hora_inicio_carga: "asc" },
    select: { id: true, volumen_asignado_m3: true },
  });
  return { ...r, dia, plantelId, plantaId, clienteId, asesorId, disenoId, viajes };
}

/** El dashboard comercial del mes en curso (adiciones y cancelaciones del asesor). */
const comercialDeHoy = () => {
  const d = new Date();
  return calcularDesempeno({ anio: d.getFullYear(), mes: d.getMonth() + 1, zona: null });
};

const snapshotDeHoy = (dia: Date) => construirSnapshot({ fecha: ymd(dia), zona: "Norte" });

/** Solo las filas de VIAJE del bloque de un cliente (descarta las bandas "Planta: X"). */
const filasViaje = (filas: FilaSnap[]): ViajeSnap[] =>
  filas.filter((f): f is ViajeSnap => f.tipo === "viaje");

beforeEach(async () => {
  await limpiarBD();
  rolActual = "Administrador";
  plantelesJefe = [];
});

describe("solo el Administrador puede eliminar un viaje", () => {
  it("el Administrador lo borra", async () => {
    const s = await escenario();
    const res = await eliminarViajeDespachoAction(s.viajes[0].id);
    expect(res.ok, res.mensaje).toBe(true);
    expect(await prisma.viajes.findUnique({ where: { id: s.viajes[0].id } })).toBeNull();
  });

  it.each<Rol>(["Despachador", "JefePlanta", "Programador", "Dosificador", "Asesor"])(
    "%s NO puede: el viaje queda intacto",
    async (rol) => {
      const s = await escenario();
      const antes = await prisma.viajes.findUniqueOrThrow({ where: { id: s.viajes[0].id } });

      rolActual = rol;
      if (rol === "JefePlanta") plantelesJefe = [s.plantelId];
      const res = await eliminarViajeDespachoAction(s.viajes[0].id);

      expect(res.ok).toBe(false);
      expect(res.mensaje).toMatch(/solo el administrador/i);
      // La foto COMPLETA del viaje no cambió (no basta con el `ok: false`).
      expect(await prisma.viajes.findUniqueOrThrow({ where: { id: s.viajes[0].id } })).toEqual(
        antes,
      );
    },
  );

  it("un viaje que no existe da un mensaje claro, no una excepción", async () => {
    await escenario();
    const res = await eliminarViajeDespachoAction(999_999);
    expect(res.ok).toBe(false);
    expect(res.mensaje).toMatch(/no encontrado/i);
  });
});

describe("eliminar NO afecta ningún estadístico", () => {
  it("no aparece como cancelación del asesor en el dashboard comercial", async () => {
    // El caso del reporte: se cargó un cliente de más y se borra su viaje. Sin rebajar
    // la línea base, al cerrar el pedido `suministrado - programado` daría negativo y
    // el asesor cargaría con una cancelación que nadie hizo.
    const s = await escenario(33);
    // Se completan los dos viajes que SÍ correspondían.
    await completar(s.viajes[0].id);
    await completar(s.viajes[1].id);

    const res = await eliminarViajeDespachoAction(s.viajes[2].id);
    expect(res.ok, res.mensaje).toBe(true);

    const c = await comercialDeHoy();
    expect(c.cancelacionesTotal).toBe(0);
    expect(c.cancelacionesM3Total).toBe(0);
    expect(c.adicionesM3Total).toBe(0);
    expect(c.registroCancelaciones).toEqual([]);
    expect(c.registroAdiciones).toEqual([]);
  });

  it("la línea base baja exactamente el volumen del viaje borrado", async () => {
    const s = await escenario(33);
    const pedidoAntes = await prisma.pedidos.findUniqueOrThrow({ where: { id: s.pedidoId } });
    const borrado = s.viajes[2];

    await eliminarViajeDespachoAction(borrado.id);

    const p = await prisma.pedidos.findUniqueOrThrow({ where: { id: s.pedidoId } });
    expect(p.volumen_programado).toBeCloseTo(
      (pedidoAntes.volumen_programado ?? 0) - borrado.volumen_asignado_m3,
      2,
    );
    // Y el total del pedido es la suma de los viajes que quedan.
    const restantes = await prisma.viajes.findMany({ where: { pedido_id: s.pedidoId } });
    expect(p.volumen_total_m3).toBeCloseTo(
      restantes.reduce((a, v) => a + v.volumen_asignado_m3, 0),
      2,
    );
  });

  it("borrar una ADICIÓN no rebaja la línea base (nunca estuvo en ella)", async () => {
    const s = await escenario(22);
    // Se agrega volumen desde Despacho: es adición, no parte del programa.
    expect((await agregarViajePedidoAction(s.pedidoId, 9)).ok).toBe(true);
    const baseAntes = (await prisma.pedidos.findUniqueOrThrow({ where: { id: s.pedidoId } }))
      .volumen_programado;
    const adicion = await prisma.viajes.findFirstOrThrow({
      where: { pedido_id: s.pedidoId, es_adicion: true },
      select: { id: true },
    });

    await eliminarViajeDespachoAction(adicion.id);

    const p = await prisma.pedidos.findUniqueOrThrow({ where: { id: s.pedidoId } });
    expect(p.volumen_programado).toBe(baseAntes);
    // Y tampoco aparece cancelación ni adición fantasma.
    const c = await comercialDeHoy();
    expect(c.cancelacionesTotal).toBe(0);
    expect(c.adicionesM3Total).toBe(0);
  });

  it("los m³ del viaje COMPLETADO por error salen de la producción real", async () => {
    const s = await escenario(33);
    for (const v of s.viajes) await completar(v.id);
    const d = new Date();

    const total = (r: { porDia: Map<string, { m3: number; viajes: number }> }) =>
      [...r.porDia.values()].reduce((a, b) => a + b.m3, 0);
    const mes = { anio: d.getFullYear(), mes: d.getMonth() + 1 };

    const antes = await produccionDelMes(mes);
    const borrado = s.viajes[2];
    await eliminarViajeDespachoAction(borrado.id);
    const despues = await produccionDelMes(mes);

    expect(total(antes) - total(despues)).toBeCloseTo(borrado.volumen_asignado_m3, 2);
  });

  it("los indicadores de planta y el horario extraordinario se recalculan sin error", async () => {
    const s = await escenario(33);
    for (const v of s.viajes) await completar(v.id);
    const desde = inicioDeHoy();
    const hasta = finDeHoy();

    const repAntes = await calcularReportes({ desde, hasta, plantelId: s.plantelId });
    const extAntes = await calcularExtraordinario({ desde, hasta, plantelIds: [s.plantelId] });

    const borrado = s.viajes[0];
    await eliminarViajeDespachoAction(borrado.id);

    const repDespues = await calcularReportes({ desde, hasta, plantelId: s.plantelId });
    const extDespues = await calcularExtraordinario({ desde, hasta, plantelIds: [s.plantelId] });

    expect(repAntes.volumenM3 - repDespues.volumenM3).toBeCloseTo(borrado.volumen_asignado_m3, 1);
    expect(extAntes.ejecutivo.viajesTotal - extDespues.ejecutivo.viajesTotal).toBe(1);
    expect(
      extAntes.ejecutivo.volumenTotal - extDespues.ejecutivo.volumenTotal,
    ).toBeCloseTo(borrado.volumen_asignado_m3, 1);
  });

  it("el reporte de tiempos de descarga deja de contarlo", async () => {
    const s = await escenario(33);
    for (const v of s.viajes) await completar(v.id);
    const rango = {
      desde: inicioDeHoy(),
      hasta: finDeHoy(),
      plantelIds: [s.plantelId],
      umbrales: UMBRALES_DESCARGA_DEFAULT,
    };

    const antes = await calcularDescargas(rango);
    await eliminarViajeDespachoAction(s.viajes[0].id);
    const despues = await calcularDescargas(rango);

    expect(antes.resumen.viajes - despues.resumen.viajes).toBe(1);
    expect(despues.detalle.some((d) => d.viajeId === s.viajes[0].id)).toBe(false);
  });
});

describe("el programa queda coherente", () => {
  it("el viaje desaparece del DPCR-08 y los totales cuadran en los tres niveles", async () => {
    const s = await escenario(33);
    const antes = await snapshotDeHoy(s.dia);
    expect(filasViaje(antes.planteles[0].pedidos[0].filas)).toHaveLength(3);

    const borrado = s.viajes[1]; // uno del MEDIO: la numeración tiene que recomponerse
    await eliminarViajeDespachoAction(borrado.id);

    const snap = await snapshotDeHoy(s.dia);
    const pedido = snap.planteles[0].pedidos[0];
    const filas = filasViaje(pedido.filas);
    expect(filas).toHaveLength(2);
    // Numeración consecutiva, sin huecos (el borrado era el #2).
    expect(filas.map((v) => v.num)).toEqual([1, 2]);
    // Total del cliente = suma de sus viajes impresos; y ese total sube a plantel y zona.
    // El volumen del snapshot viene ya FORMATEADO ("11.00 m³"): se lee el número.
    const sumaViajes = filas.reduce((a, v) => a + Number.parseFloat(v.volumen), 0);
    expect(pedido.totalM3).toBeCloseTo(sumaViajes, 2);
    expect(snap.planteles[0].totalM3).toBeCloseTo(pedido.totalM3, 2);
    expect(snap.totalZona).toBeCloseTo(snap.planteles[0].totalM3, 2);
  });

  it("una versión del DPCR-08 ya archivada CONSERVA el viaje", async () => {
    // Un documento controlado ya emitido no se reescribe retroactivamente.
    const s = await escenario(33);
    const snap = await snapshotDeHoy(s.dia);
    const archivada = await prisma.programas_dpcr08.create({
      data: {
        fecha_programa: inicioDeHoy(),
        zona: "Norte",
        snapshot_json: snap as unknown as object,
        generado_por: "prueba",
        version: 1,
      },
    });

    await eliminarViajeDespachoAction(s.viajes[0].id);

    const reg = await prisma.programas_dpcr08.findUniqueOrThrow({ where: { id: archivada.id } });
    const guardado = reg.snapshot_json as unknown as typeof snap;
    expect(filasViaje(guardado.planteles[0].pedidos[0].filas)).toHaveLength(3);
    expect(guardado).toEqual(snap);
  });

  it("los viajes que quedan conservan su hora de carga: borrar no adelanta a nadie", async () => {
    const s = await escenario(44);
    const antes = await prisma.viajes.findMany({
      where: { pedido_id: s.pedidoId, id: { not: s.viajes[1].id } },
      orderBy: { id: "asc" },
      select: { id: true, hora_inicio_carga: true, hora_llegada_proyecto: true, mixer_id: true },
    });

    await eliminarViajeDespachoAction(s.viajes[1].id);

    const despues = await prisma.viajes.findMany({
      where: { pedido_id: s.pedidoId },
      orderBy: { id: "asc" },
      select: { id: true, hora_inicio_carga: true, hora_llegada_proyecto: true, mixer_id: true },
    });
    expect(despues).toEqual(antes);
  });

  it("borrar no mueve el horario de OTRO cliente", async () => {
    const s = await escenario(22);
    const otroCliente = await crearCliente(true, 30, 30);
    const otro = await programarPedido({
      cliente_id: otroCliente,
      diseno_id: s.disenoId,
      plantel_id: s.plantelId,
      planta_id: s.plantaId,
      volumen_total_m3: 11,
      hora_solicitada: hoyALas(11),
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });
    const antes = await prisma.viajes.findMany({
      where: { pedido_id: otro.pedidoId },
      orderBy: { id: "asc" },
    });

    await eliminarViajeDespachoAction(s.viajes[0].id);

    const despues = await prisma.viajes.findMany({
      where: { pedido_id: otro.pedidoId },
      orderBy: { id: "asc" },
    });
    expect(despues).toEqual(antes);
  });
});

describe("no genera error en ninguna parte del sistema", () => {
  it("un viaje COMPLETADO se puede eliminar (cancelar no lo permite)", async () => {
    // Es justo el caso que hoy no tiene salida: el camión cargado por error se marchó
    // hasta el final antes de que alguien lo notara, y es el que sí mueve los m³.
    const s = await escenario(33);
    await completar(s.viajes[0].id);

    const noSePuedeCancelar = await cancelarViajeAction(s.viajes[0].id);
    expect(noSePuedeCancelar.ok).toBe(false);

    const res = await eliminarViajeDespachoAction(
      s.viajes[0].id,
      "se cargó con el diseño equivocado",
    );
    expect(res.ok, res.mensaje).toBe(true);
    expect(await prisma.viajes.findUnique({ where: { id: s.viajes[0].id } })).toBeNull();
  });

  it("un viaje ya CANCELADO también se puede eliminar (deja de aparecer)", async () => {
    const s = await escenario(33);
    expect((await cancelarViajeAction(s.viajes[0].id, "por error")).ok).toBe(true);
    expect((await eliminarViajeDespachoAction(s.viajes[0].id)).ok).toBe(true);
    expect(await prisma.viajes.findUnique({ where: { id: s.viajes[0].id } })).toBeNull();
  });

  it("borrar el ÚLTIMO viaje elimina el pedido y libera su proyección semanal", async () => {
    const s = await escenario(11); // un solo viaje
    expect(s.viajes).toHaveLength(1);
    const solicitud = await prisma.solicitudes_anticipadas.create({
      data: {
        cliente_id: s.clienteId,
        asesor_id: s.asesorId,
        fecha_requerida: inicioDeHoy(),
        volumen_estimado_m3: 11,
        estado: "Programado",
        pedido_id: s.pedidoId,
        creado_por: "prueba",
      },
    });

    const res = await eliminarViajeDespachoAction(s.viajes[0].id);
    expect(res.ok, res.mensaje).toBe(true);

    expect(await prisma.pedidos.findUnique({ where: { id: s.pedidoId } })).toBeNull();
    // La proyección NO queda "Programado" apuntando a un pedido inexistente: eso la
    // dejaría congelada para siempre (una proyección programada es historial y nadie
    // la edita). Vuelve a Pendiente para que el asesor pueda replanificar.
    const sol = await prisma.solicitudes_anticipadas.findUniqueOrThrow({
      where: { id: solicitud.id },
    });
    expect(sol.estado).toBe("Pendiente");
    expect(sol.pedido_id).toBeNull();
  });

  it("se borran las lecturas de calidad del viaje y sobrevive el control general", async () => {
    const s = await escenario(33);
    await prisma.control_calidad_viaje.create({
      data: { viaje_id: s.viajes[0].id, revenimiento_obra: 5, temperatura_concreto: 30 },
    });
    await prisma.control_calidad_viaje.create({
      data: { viaje_id: s.viajes[1].id, revenimiento_obra: 4.5, temperatura_concreto: 31 },
    });
    await prisma.control_calidad_general.create({
      data: { pedido_id: s.pedidoId, m3_programados: 33, observaciones: "sin novedad" },
    });

    await eliminarViajeDespachoAction(s.viajes[0].id);

    expect(
      await prisma.control_calidad_viaje.findUnique({ where: { viaje_id: s.viajes[0].id } }),
    ).toBeNull();
    expect(
      await prisma.control_calidad_viaje.findUnique({ where: { viaje_id: s.viajes[1].id } }),
    ).not.toBeNull();
    expect(
      await prisma.control_calidad_general.findUnique({ where: { pedido_id: s.pedidoId } }),
    ).not.toBeNull();
  });

  it("la ventana del laboratorista se recalcula, y con cero viajes no revienta", async () => {
    const s = await escenario(22);
    const leer = async () => {
      const p = await prisma.pedidos.findUnique({
        where: { id: s.pedidoId },
        select: {
          hora_solicitada: true,
          viajes: {
            select: {
              mixer_id: true,
              hora_llegada_proyecto: true,
              hora_regreso_planta: true,
              hora_fin_descarga: true,
              ts_llegada_real: true,
              ts_regreso_real: true,
              ts_fin_descarga_real: true,
            },
          },
        },
      });
      return p ? ventanaDePedido(p.viajes, p.hora_solicitada) : null;
    };
    expect(await leer()).not.toBeNull();

    await eliminarViajeDespachoAction(s.viajes[0].id);
    expect(await leer()).not.toBeNull(); // queda un viaje

    await eliminarViajeDespachoAction(s.viajes[1].id);
    expect(await leer()).toBeNull(); // el pedido ya no existe: sin ventana, sin error
  });

  it("el latido cambia, así que las pantallas abiertas se refrescan", async () => {
    const s = await escenario(33);
    const rango = { desde: inicioDeHoy(), hasta: finDeHoy(), plantelIds: [s.plantelId] };
    const antes = await firmaLatido(rango);

    await eliminarViajeDespachoAction(s.viajes[0].id);

    expect(await firmaLatido(rango)).not.toBe(antes);
  });

  it("la bitácora deja escrito QUÉ se borró y el ajuste de la línea base", async () => {
    const s = await escenario(33);
    const borrado = s.viajes[0];

    await eliminarViajeDespachoAction(borrado.id, "diseno equivocado");

    // La fila del viaje ya no existe: la bitácora es el único registro.
    const reg = await prisma.bitacora_auditoria.findFirstOrThrow({
      where: { tabla_afectada: "viajes", registro_id: borrado.id, campo_modificado: "eliminado" },
    });
    expect(reg.usuario).toBe("Admin Prueba");
    expect(reg.motivo).toMatch(/ELIMINADO por el Administrador/);
    expect(reg.motivo).toMatch(/diseno equivocado/);
    expect(reg.valor_anterior).toMatch(/programado 11 m3/);
    expect(reg.valor_anterior).toMatch(/estado Programado/);

    // Y el ajuste de la base, aparte y auditable.
    const base = await prisma.bitacora_auditoria.findFirstOrThrow({
      where: {
        tabla_afectada: "pedidos",
        registro_id: s.pedidoId,
        campo_modificado: "volumen_programado",
      },
    });
    expect(Number(base.valor_anterior) - Number(base.valor_nuevo)).toBeCloseTo(
      borrado.volumen_asignado_m3,
      2,
    );
  });
});
