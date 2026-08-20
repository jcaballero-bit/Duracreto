// Calendario de producción contra la BASE DE DATOS: el dato que pinta el calendario
// debe ser EXACTAMENTE la producción ejecutada (viajes Completado), no lo programado.
//
// Se prueba con el mismo camino que usa la pantalla (`produccionDelMes`) e incluye la
// comprobación de alcance: un Jefe de Planta con un solo plantel asignado no puede ver
// el volumen de otro plantel, aunque el filtro se lo pida.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularAlcance, filtroPedidoPorZona } from "@/lib/auth/acceso";
import { avanzarEstadoViaje, programarPedido } from "@/lib/motor/asignacion";
import { ESTADO_VIAJE_COMPLETADO, SECUENCIA_ESTADOS_VIAJE } from "@/lib/motor/config";
import { produccionDelMes } from "@/lib/produccion/consulta";
import { armarSemanas, resumenMes, ymdLocal } from "@/lib/produccion/calendario";
import { construirSnapshot } from "@/lib/programa/snapshot";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

/** Día de trabajo de la prueba (llegada pedida a las 8:00). */
const DIA = new Date(2026, 7, 12, 8, 0, 0, 0);
const ISO = ymdLocal(DIA);

/** Lleva un viaje hasta Completado recorriendo la secuencia real de estados. */
async function completar(viajeId: number) {
  for (const estado of SECUENCIA_ESTADOS_VIAJE) {
    await avanzarEstadoViaje(viajeId, estado);
    if (estado === ESTADO_VIAJE_COMPLETADO) break;
  }
}

async function escenario() {
  const norte = await crearPlantel({ nombre: "Santa Marta", zona: "Norte", esHub: true, capacidadPlantaM3h: 45 });
  const otro = await crearPlantel({ nombre: "Choloma", zona: "Norte", hubId: norte.plantelId, capacidadPlantaM3h: 28 });
  await crearMixers(norte.plantelId, [[11, 4]]);
  await crearMixers(otro.plantelId, [[11, 2]]);
  const disenoId = await crearDiseno();
  return { norte, otro, disenoId };
}

beforeEach(async () => {
  await limpiarBD();
});

describe("producciónDelMes — solo lo despachado", () => {
  it("el total del día es la suma de los viajes Completado, y cuadra con el programa de esa fecha", async () => {
    const { norte, disenoId } = await escenario();
    const clienteId = await crearCliente(true, 30, 30);
    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      plantel_id: norte.plantelId,
      planta_id: norte.plantaId,
      volumen_total_m3: 33,
      hora_solicitada: DIA,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });
    const viajes = r.viajes.filter((v) => v.mixerId != null);
    expect(viajes.length).toBe(3);
    // Se completan DOS de los tres: el tercero sigue programado.
    await completar(viajes[0].id);
    await completar(viajes[1].id);

    const esperado =
      (await prisma.viajes.findMany({
        where: { estado: ESTADO_VIAJE_COMPLETADO },
        select: { volumen_asignado_m3: true },
      })).reduce((s, v) => s + v.volumen_asignado_m3, 0);

    const prod = await produccionDelMes({ anio: 2026, mes: 8 });
    expect(prod.porDia.get(ISO)!.m3).toBe(Math.round(esperado * 10) / 10);
    expect(prod.porDia.get(ISO)!.viajes).toBe(2);

    // Cruce con el Programa DPCR-08 de esa fecha: el volumen despachado no puede
    // exceder lo programado, y los viajes contados son los mismos del documento.
    const snap = await construirSnapshot({ fecha: ISO, zona: "Norte" });
    const totalPrograma = snap.planteles.reduce((s, pl) => s + pl.totalM3, 0);
    const viajesPrograma = snap.planteles
      .flatMap((pl) => pl.pedidos)
      .flatMap((p) => p.filas)
      .filter((f) => f.tipo === "viaje").length;
    expect(prod.porDia.get(ISO)!.m3).toBeLessThanOrEqual(totalPrograma);
    expect(viajesPrograma).toBe(3); // el programa sigue mostrando los 3
  });

  it("no cuenta lo programado a futuro: un día sin viajes completados queda vacío", async () => {
    const { norte, disenoId } = await escenario();
    const clienteId = await crearCliente(true, 30, 30);
    await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      plantel_id: norte.plantelId,
      planta_id: norte.plantaId,
      volumen_total_m3: 22,
      hora_solicitada: DIA,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });

    const prod = await produccionDelMes({ anio: 2026, mes: 8 });
    expect(prod.porDia.size).toBe(0); // nada completado ⇒ ningún día con dato
    const semanas = armarSemanas(2026, 8, prod.porDia);
    const dias = semanas.flatMap((s) => s.dias).filter((d) => d.delMes);
    expect(dias.every((d) => d.m3 === 0)).toBe(true); // celdas vacías, no "0.00"
    expect(resumenMes(semanas)).toMatchObject({ totalM3: 0, diasConProduccion: 0, promedioPorDia: 0 });
  });

  it("un pedido cancelado no aporta al calendario", async () => {
    const { norte, disenoId } = await escenario();
    const clienteId = await crearCliente(true, 30, 30);
    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      plantel_id: norte.plantelId,
      planta_id: norte.plantaId,
      volumen_total_m3: 11,
      hora_solicitada: DIA,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });
    await completar(r.viajes.find((v) => v.mixerId != null)!.id);
    expect((await produccionDelMes({ anio: 2026, mes: 8 })).porDia.get(ISO)!.m3).toBeGreaterThan(0);

    await prisma.pedidos.update({
      where: { id: r.pedidoId },
      data: { estado_pedido: "Cancelado", fecha_cancelacion: DIA },
    });
    expect((await produccionDelMes({ anio: 2026, mes: 8 })).porDia.get(ISO)).toBeUndefined();
  });

  it("el desglose por plantel suma el total del día y no lista planteles en cero", async () => {
    const { norte, otro, disenoId } = await escenario();
    const clienteA = await crearCliente(true, 30, 30);
    const clienteB = await crearCliente(true, 30, 30);
    const base = { diseno_id: disenoId, tipo_descarga: "Canal directo", creado_por: "test", hora_solicitada: DIA };

    const a = await programarPedido({
      ...base,
      cliente_id: clienteA,
      plantel_id: norte.plantelId,
      planta_id: norte.plantaId,
      volumen_total_m3: 22,
    });
    const b = await programarPedido({
      ...base,
      cliente_id: clienteB,
      plantel_id: otro.plantelId,
      planta_id: otro.plantaId,
      volumen_total_m3: 11,
    });
    for (const v of a.viajes.filter((v) => v.mixerId != null)) await completar(v.id);
    await completar(b.viajes.find((v) => v.mixerId != null)!.id);

    const prod = await produccionDelMes({ anio: 2026, mes: 8 });
    const desglose = prod.porDiaPlantel.get(ISO)!;
    // Solo los dos planteles que despacharon (no hay filas de ceros).
    expect(desglose.map((d) => d.nombre).sort()).toEqual(["Choloma", "Santa Marta"]);
    const suma = Math.round(desglose.reduce((s, d) => s + d.m3, 0) * 10) / 10;
    expect(suma).toBe(prod.porDia.get(ISO)!.m3);
    // Y el orden es de mayor a menor volumen.
    expect(desglose[0].nombre).toBe("Santa Marta");
    expect(desglose.reduce((s, d) => s + d.viajes, 0)).toBe(prod.porDia.get(ISO)!.viajes);
  });

  it("un Jefe de Planta con un solo plantel asignado ve SOLO ese plantel", async () => {
    const { norte, otro, disenoId } = await escenario();
    const clienteA = await crearCliente(true, 30, 30);
    const clienteB = await crearCliente(true, 30, 30);
    const base = { diseno_id: disenoId, tipo_descarga: "Canal directo", creado_por: "test", hora_solicitada: DIA };
    const a = await programarPedido({
      ...base,
      cliente_id: clienteA,
      plantel_id: norte.plantelId,
      planta_id: norte.plantaId,
      volumen_total_m3: 22,
    });
    const b = await programarPedido({
      ...base,
      cliente_id: clienteB,
      plantel_id: otro.plantelId,
      planta_id: otro.plantaId,
      volumen_total_m3: 11,
    });
    for (const v of a.viajes.filter((v) => v.mixerId != null)) await completar(v.id);
    await completar(b.viajes.find((v) => v.mixerId != null)!.id);

    // Jefe de Planta de Choloma: su alcance es solo ese plantel.
    const alcance = calcularAlcance(["JefePlanta"], null, null, null, [otro.plantelId]);
    const prod = await produccionDelMes({
      anio: 2026,
      mes: 8,
      filtroPedido: filtroPedidoPorZona(alcance),
    });
    const desglose = prod.porDiaPlantel.get(ISO)!;
    expect(desglose.map((d) => d.nombre)).toEqual(["Choloma"]);
    expect(prod.porDia.get(ISO)!.m3).toBe(desglose[0].m3);

    // Y el Administrador sí ve los dos planteles en el mismo día.
    const admin = calcularAlcance(["Administrador"], null, null, null, []);
    const todo = await produccionDelMes({ anio: 2026, mes: 8, filtroPedido: filtroPedidoPorZona(admin) });
    expect(todo.porDiaPlantel.get(ISO)!.length).toBe(2);
    expect(todo.porDia.get(ISO)!.m3).toBeGreaterThan(prod.porDia.get(ISO)!.m3);
  });

  it("el filtro de zona acota el mes a los planteles de esa zona", async () => {
    const { norte, disenoId } = await escenario();
    const sur = await crearPlantel({ nombre: "Tegucigalpa", zona: "Centro Sur", esHub: true });
    await crearMixers(sur.plantelId, [[11, 2]]);
    const clienteA = await crearCliente(true, 30, 30);
    const clienteB = await crearCliente(true, 30, 30);
    const base = { diseno_id: disenoId, tipo_descarga: "Canal directo", creado_por: "test", hora_solicitada: DIA };
    const a = await programarPedido({
      ...base,
      cliente_id: clienteA,
      plantel_id: norte.plantelId,
      planta_id: norte.plantaId,
      volumen_total_m3: 11,
    });
    const b = await programarPedido({
      ...base,
      cliente_id: clienteB,
      plantel_id: sur.plantelId,
      planta_id: sur.plantaId,
      volumen_total_m3: 11,
    });
    await completar(a.viajes.find((v) => v.mixerId != null)!.id);
    await completar(b.viajes.find((v) => v.mixerId != null)!.id);

    const soloNorte = await produccionDelMes({ anio: 2026, mes: 8, zona: "Norte" });
    expect(soloNorte.porDiaPlantel.get(ISO)!.map((d) => d.zona)).toEqual(["Norte"]);
    const ambas = await produccionDelMes({ anio: 2026, mes: 8 });
    expect(ambas.porDiaPlantel.get(ISO)!.length).toBe(2);
  });
});
