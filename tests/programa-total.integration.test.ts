// El "Total" del Programa DPCR-08 tiene que ser la SUMA de la columna Vol. que el
// documento imprime, en los tres niveles: cliente, plantel y zona.
//
// Antes el Total salía de `volumen_programado` (la línea base congelada) y no cuadraba
// con la columna. El descuadre tenía dos causas, las dos corregidas:
//   · el despachador bajaba el volumen de un camión durante el día y eso reescribía el
//     dato del programa (bitácora "9 → 7"): ahora ese valor va a `volumen_real_m3` y
//     el documento no se mueve (ver `despacho-no-modifica-programa`);
//   · el pedido se edita DESPUÉS del cierre: `volumen_programado` queda congelado
//     mientras los viajes ya suman otra cosa, y el documento debe imprimir los viajes.
// `volumen_programado` sigue siendo la línea base de las métricas comerciales; lo que
// cambió es qué número se IMPRIME: la suma de la columna Vol.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { editarVolumenViaje, programarPedido } from "@/lib/motor/asignacion";
import { construirSnapshot, totalImpreso, ymd } from "@/lib/programa/snapshot";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

const DIA = new Date(2026, 7, 25, 8, 0, 0, 0);

/** Suma de la columna Vol. de un pedido tal como se imprime. */
function sumaColumna(filas: { tipo: string; volumen?: string }[]): number {
  const n = filas
    .filter((f) => f.tipo === "viaje" && f.volumen && f.volumen !== "-")
    .reduce((s, f) => s + parseFloat(f.volumen!), 0);
  return Math.round(n * 100) / 100;
}

async function escenario() {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "Santa Marta",
    zona: "Norte",
    esHub: true,
    capacidadPlantaM3h: 45,
  });
  await crearMixers(plantelId, [[11, 4]]);
  const disenoId = await crearDiseno();
  return { plantelId, plantaId, disenoId };
}

beforeEach(async () => {
  await limpiarBD();
});

describe("totalImpreso (regla pura)", () => {
  it("suma los viajes que se imprimen (con mixer)", () => {
    expect(
      totalImpreso({
        volumen_programado: 150,
        volumen_total_m3: 150,
        viajes: [
          { mixer_id: 1, volumen_asignado_m3: 11 },
          { mixer_id: 2, volumen_asignado_m3: 7 },
          { mixer_id: null, volumen_asignado_m3: 9 }, // sin mixer: no se imprime
        ],
      }),
    ).toBe(18);
  });

  it("sin viajes impresos cae al volumen del pedido (no muestra 0.00)", () => {
    expect(totalImpreso({ volumen_programado: 35, volumen_total_m3: 35, viajes: [] })).toBe(35);
    expect(
      totalImpreso({
        volumen_programado: 35,
        volumen_total_m3: 35,
        viajes: [{ mixer_id: null, volumen_asignado_m3: 35 }],
      }),
    ).toBe(35);
  });

  it("no arrastra cola de coma flotante", () => {
    expect(
      totalImpreso({
        volumen_programado: 0,
        volumen_total_m3: 0,
        viajes: [
          { mixer_id: 1, volumen_asignado_m3: 11.75 },
          { mixer_id: 2, volumen_asignado_m3: 9.5 },
          { mixer_id: 3, volumen_asignado_m3: 5.25 },
        ],
      }),
    ).toBe(26.5);
  });
});

describe("Total del DPCR-08 contra la columna Vol.", () => {
  it("cuadra en el caso normal (nada editado)", async () => {
    const { plantelId, plantaId, disenoId } = await escenario();
    const clienteId = await crearCliente(true, 30, 30);
    await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      plantel_id: plantelId,
      planta_id: plantaId,
      volumen_total_m3: 33,
      hora_solicitada: DIA,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });

    const snap = await construirSnapshot({ fecha: ymd(DIA), zona: "Norte" });
    const p = snap.planteles.flatMap((pl) => pl.pedidos)[0];
    expect(p.totalM3).toBe(33);
    expect(sumaColumna(p.filas)).toBe(33);
  });

  it("el caso reportado: bajar el volumen en Despacho NO mueve el Total ni las filas", async () => {
    const { plantelId, plantaId, disenoId } = await escenario();
    const clienteId = await crearCliente(true, 30, 30);
    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      plantel_id: plantelId,
      planta_id: plantaId,
      volumen_total_m3: 33,
      hora_solicitada: DIA,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });
    // 9 → 7 en un camión (lo mismo que muestra la bitácora del caso real). Esto ya
    // NO toca el programa: el volumen real vive en su propia columna.
    const viaje = r.viajes.find((v) => v.mixerId != null)!;
    const vol0 = viaje.volumen;
    const res = await editarVolumenViaje(viaje.id, vol0 - 2, "despachador");
    expect(res.ok).toBe(true);

    const snap = await construirSnapshot({ fecha: ymd(DIA), zona: "Norte" });
    const p = snap.planteles.flatMap((pl) => pl.pedidos)[0];
    // El documento sigue diciendo lo publicado, y cuadra con su propia columna.
    expect(p.totalM3).toBe(33);
    expect(sumaColumna(p.filas)).toBe(33);
    // La línea base y el volumen programado del viaje quedan intactos; lo real, aparte.
    const ped = await prisma.pedidos.findUniqueOrThrow({ where: { id: r.pedidoId } });
    expect(ped.volumen_programado).toBe(33);
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: viaje.id } });
    expect(v.volumen_asignado_m3).toBe(vol0);
    expect(v.volumen_real_m3).toBe(vol0 - 2);
  });

  it("un pedido editado tras el cierre imprime lo que suman sus viajes, no la base congelada", async () => {
    const { plantelId, plantaId, disenoId } = await escenario();
    const clienteId = await crearCliente(true, 30, 30);
    const r = await programarPedido({
      cliente_id: clienteId,
      diseno_id: disenoId,
      plantel_id: plantelId,
      planta_id: plantaId,
      volumen_total_m3: 22,
      hora_solicitada: DIA,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });
    // Congelamiento: la línea base se queda en 22 aunque el pedido crezca.
    await prisma.pedidos.update({
      where: { id: r.pedidoId },
      data: { volumen_programado: 22, volumen_total_m3: 44 },
    });
    await prisma.viajes.updateMany({
      where: { pedido_id: r.pedidoId },
      data: { volumen_asignado_m3: 22 }, // 2 viajes de 22 = 44
    });

    const snap = await construirSnapshot({ fecha: ymd(DIA), zona: "Norte" });
    const p = snap.planteles.flatMap((pl) => pl.pedidos)[0];
    expect(p.totalM3).toBe(44);
    expect(sumaColumna(p.filas)).toBe(44);
  });

  it("los totales cuadran en los tres niveles: cliente, plantel y zona", async () => {
    const { plantelId, plantaId, disenoId } = await escenario();
    const otro = await crearPlantel({ nombre: "Choloma", zona: "Norte", hubId: plantelId });
    await crearMixers(otro.plantelId, [[11, 2]]);
    const base = {
      diseno_id: disenoId,
      tipo_descarga: "Canal directo",
      creado_por: "test",
      hora_solicitada: DIA,
    };
    const a = await programarPedido({
      ...base,
      cliente_id: await crearCliente(true, 30, 30),
      plantel_id: plantelId,
      planta_id: plantaId,
      volumen_total_m3: 33,
    });
    await programarPedido({
      ...base,
      cliente_id: await crearCliente(true, 30, 30),
      plantel_id: otro.plantelId,
      planta_id: otro.plantaId,
      volumen_total_m3: 11,
    });
    // Un ajuste de volumen en Despacho: no debe alterar ningún total del documento.
    const viaje = a.viajes.find((v) => v.mixerId != null)!;
    await editarVolumenViaje(viaje.id, viaje.volumen - 3.5, "despachador");

    const snap = await construirSnapshot({ fecha: ymd(DIA), zona: "Norte" });
    let sumaZona = 0;
    for (const pl of snap.planteles) {
      const sumaClientes =
        Math.round(pl.pedidos.reduce((s, p) => s + p.totalM3, 0) * 100) / 100;
      expect(pl.totalM3).toBe(sumaClientes);
      for (const p of pl.pedidos) expect(sumaColumna(p.filas)).toBe(p.totalM3);
      sumaZona += pl.totalM3;
    }
    expect(snap.totalZona).toBe(Math.round(sumaZona * 100) / 100);
    expect(snap.totalZona).toBe(33 + 11); // lo PROGRAMADO, sin el ajuste de Despacho
  });
});
