// INVARIANTE: lo que pase en Despacho en vivo NO modifica el Programa DPCR-08.
//
// El DPCR-08 es un documento controlado que se publica la tarde anterior. Si el
// despachador carga MENOS de lo programado (o se cae un viaje, o se completan menos
// viajes de los previstos), el documento tiene que seguir diciendo lo que se publicó:
// la desviación se mide comparando la realidad CONTRA el programa, así que si el
// programa se reescribe solo, ya no hay contra qué comparar.
//
// Se prueba por las SERVER ACTIONS (el camino real de la pantalla) y comparando el
// snapshot completo —el JSON del que salen la vista previa y el PDF— antes y después.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";
import { avanzarEstadoViaje, programarPedido } from "@/lib/motor/asignacion";
import { ESTADO_VIAJE_COMPLETADO, SECUENCIA_ESTADOS_VIAJE } from "@/lib/motor/config";
import { construirSnapshot, ymd } from "@/lib/programa/snapshot";
import { produccionDelMes } from "@/lib/produccion/consulta";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

let rolActual: "Despachador" | "Administrador" = "Despachador";

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "u1", name: "Despachador Prueba", email: "d@test.com" } }),
}));
vi.mock("@/lib/auth/guard", () => ({
  alcanceActual: async () => calcularAlcance([rolActual], "Norte", null, null, []),
  requerirAcceso: async () => calcularAlcance([rolActual], "Norte", null, null, []),
  exigirAdmin: async () => ({ ok: true, userId: "u1" }),
  exigirGestionFlota: async () => ({ ok: true, userId: "u1" }),
  requerirPasswordAlDia: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { editarVolumenAction, cancelarViajeAction } = await import("@/app/actions");

/** El día del programa: HOY, que es el único que opera Despacho. */
function hoyALas(h: number): Date {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d;
}

/** Lleva un viaje hasta Completado por la secuencia real de estados. */
async function completar(viajeId: number) {
  for (const estado of SECUENCIA_ESTADOS_VIAJE) {
    await avanzarEstadoViaje(viajeId, estado);
    if (estado === ESTADO_VIAJE_COMPLETADO) break;
  }
}

async function escenario(volumen: number) {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "Santa Marta",
    zona: "Norte",
    esHub: true,
    capacidadPlantaM3h: 45,
  });
  await crearMixers(plantelId, [[11, 4]]);
  const clienteId = await crearCliente(true, 30, 30);
  const disenoId = await crearDiseno();
  const dia = hoyALas(8);
  const r = await programarPedido({
    cliente_id: clienteId,
    diseno_id: disenoId,
    plantel_id: plantelId,
    planta_id: plantaId,
    volumen_total_m3: volumen,
    hora_solicitada: dia,
    tipo_descarga: "Canal directo",
    creado_por: "test",
  });
  return { ...r, dia, plantelId, plantaId };
}

const snapshotDelDia = (dia: Date) => construirSnapshot({ fecha: ymd(dia), zona: "Norte" });

beforeEach(async () => {
  await limpiarBD();
  rolActual = "Despachador";
});

describe("Despacho en vivo NO modifica el Programa DPCR-08", () => {
  it("cargar MENOS de lo programado no cambia el documento", async () => {
    const s = await escenario(33);
    const antes = await snapshotDelDia(s.dia);

    // El despachador carga 7 m³ en un camión que iba con 11.
    const viaje = s.viajes.find((v) => v.mixerId != null)!;
    const res = await editarVolumenAction(viaje.id, 7);
    expect(res.ok).toBe(true);

    // El documento ENTERO es idéntico: mismas filas, mismos volúmenes, mismos totales.
    expect(await snapshotDelDia(s.dia)).toEqual(antes);
  });

  it("el volumen REAL cargado queda registrado, sin tocar el programado", async () => {
    const s = await escenario(33);
    const viaje = s.viajes.find((v) => v.mixerId != null)!;
    const programado = viaje.volumen;
    await editarVolumenAction(viaje.id, programado - 4);

    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: viaje.id } });
    expect(v.volumen_asignado_m3).toBe(programado); // el programa no se movió
    expect(v.volumen_real_m3).toBe(programado - 4); // la realidad quedó guardada
    // Y la bitácora deja constancia del cambio real.
    const reg = await prisma.bitacora_auditoria.findFirstOrThrow({
      where: { tabla_afectada: "viajes", registro_id: viaje.id, campo_modificado: "volumen_real_m3" },
    });
    expect(reg.valor_anterior).toBe(String(programado));
    expect(reg.valor_nuevo).toBe(String(programado - 4));
  });

  it("lo despachado de menos SÍ se refleja en la producción real", async () => {
    const s = await escenario(22);
    const viajes = s.viajes.filter((v) => v.mixerId != null);
    await editarVolumenAction(viajes[0].id, 6); // cargó 6 en vez de 11
    for (const v of viajes) await completar(v.id);

    const prod = await produccionDelMes({ anio: s.dia.getFullYear(), mes: s.dia.getMonth() + 1 });
    // 6 + 11 = 17 despachados, aunque el programa siga diciendo 22.
    expect(prod.porDia.get(ymd(s.dia))!.m3).toBe(17);
    const snap = await snapshotDelDia(s.dia);
    expect(snap.totalZona).toBe(22);
  });

  it("completar solo una parte de los viajes no cambia el documento", async () => {
    const s = await escenario(33);
    const antes = await snapshotDelDia(s.dia);

    const conMixer = s.viajes.filter((v) => v.mixerId != null);
    await completar(conMixer[0].id);
    await avanzarEstadoViaje(conMixer[1].id, "En carga");

    expect(await snapshotDelDia(s.dia)).toEqual(antes);
  });

  it("cancelar UN viaje del día no borra su fila del documento publicado", async () => {
    const s = await escenario(33);
    const antes = await snapshotDelDia(s.dia);

    const viaje = s.viajes.filter((v) => v.mixerId != null).at(-1)!;
    const res = await cancelarViajeAction(viaje.id, "El cliente no estaba listo");
    expect(res.ok).toBe(true);

    // El programa publicado conserva el viaje y su volumen: la cancelación se ve en
    // Despacho y en las métricas, no reescribiendo el documento.
    expect(await snapshotDelDia(s.dia)).toEqual(antes);
  });

  it("editar el volumen de VARIOS viajes no mueve los totales de plantel ni de zona", async () => {
    const s = await escenario(44);
    const antes = await snapshotDelDia(s.dia);

    for (const v of s.viajes.filter((x) => x.mixerId != null).slice(0, 3)) {
      await editarVolumenAction(v.id, 6);
    }

    const despues = await snapshotDelDia(s.dia);
    expect(despues.totalZona).toBe(antes.totalZona);
    expect(despues.planteles.map((p) => p.totalM3)).toEqual(antes.planteles.map((p) => p.totalM3));
    expect(despues).toEqual(antes);
  });

  it("el Administrador corrigiendo un viaje YA despachado tampoco cambia el documento", async () => {
    const s = await escenario(22);
    const viaje = s.viajes.find((v) => v.mixerId != null)!;
    await completar(viaje.id);
    const antes = await snapshotDelDia(s.dia);

    rolActual = "Administrador"; // solo el Admin puede corregir un viaje ya despachado
    const res = await editarVolumenAction(viaje.id, 8);
    expect(res.ok).toBe(true);

    expect(await snapshotDelDia(s.dia)).toEqual(antes);
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: viaje.id } });
    expect(v.volumen_real_m3).toBe(8);
    expect(v.volumen_asignado_m3).toBe(viaje.volumen);
  });
});
